
-- =============================================================================
-- Orphan SKU Cleanup
-- =============================================================================
-- "Orphan SKUs" are rows in public.skus where user_id IS NULL.
-- These rows were inserted without an owner and are permanently invisible to
-- every authenticated user via RLS (all four policies require auth.uid() =
-- user_id).  They accumulate silently and waste storage.
--
-- This migration adds:
--   1. public.v_orphan_skus  — audit view to COUNT / inspect orphans before
--                              any destructive action.
--   2. public.purge_orphan_skus() — SECURITY DEFINER function that safely
--                              deletes every orphan row and returns the number
--                              of rows removed.  Must be called explicitly by
--                              a super-admin / service-role — it is NOT
--                              triggered automatically.
--
-- Idempotency: CREATE OR REPLACE is used throughout; running this migration
-- multiple times is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_orphan_skus AS
SELECT *
FROM public.skus
WHERE user_id IS NULL;

COMMENT ON VIEW public.v_orphan_skus IS
  'Lists every SKU row whose user_id is NULL. '
  'These rows are inaccessible via RLS and should be purged with purge_orphan_skus().';

-- ---------------------------------------------------------------------------
-- 2. Purge function
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER lets a service-role caller bypass RLS so it can actually
-- see (and delete) the NULL-user_id rows that ordinary authenticated sessions
-- cannot touch.
-- The function is owned by the "postgres" role (the migration runner) and can
-- only be called by roles that have been explicitly GRANTed EXECUTE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_orphan_skus()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer;
BEGIN
  -- Delete orphan rows (user_id IS NULL) and capture the count.
  DELETE FROM public.skus
  WHERE user_id IS NULL;

  GET DIAGNOSTICS _deleted = ROW_COUNT;

  -- Write an audit entry to sku_change_history if any rows were removed.
  -- The table may not exist on older deployments, so we guard with a dynamic
  -- query to keep the function safe even in partial deployments.
  IF _deleted > 0 THEN
    BEGIN
      INSERT INTO public.sku_change_history (
        sku_id,
        user_id,
        source_type,
        operation,
        before_data,
        after_data
      )
      VALUES (
        NULL,   -- no specific sku_id (batch operation)
        NULL,   -- no owning user (orphan rows had none)
        'admin',
        'delete',
        jsonb_build_object(
          'orphan_rows_deleted', _deleted,
          'purged_at',           now()
        ),
        NULL
      );
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      -- sku_change_history not yet present; silently skip the audit log.
      NULL;
    END;
  END IF;

  RETURN _deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_orphan_skus() IS
  'Deletes all rows from public.skus where user_id IS NULL. '
  'Returns the number of rows deleted. '
  'Must be called explicitly by a service-role or super-admin — '
  'it is NOT triggered automatically. '
  'Writes one summary row to sku_change_history when rows are deleted.';

-- Restrict execution to the postgres super-user / service-role by default.
-- Grant to additional roles as needed (e.g.: GRANT EXECUTE ON FUNCTION
-- public.purge_orphan_skus() TO service_role;)
REVOKE ALL ON FUNCTION public.purge_orphan_skus() FROM PUBLIC;
