-- =============================================================================
-- Silvery Engine tables
--
-- Creates the two tables required by the Silvery Engine tab:
--   • silvery_engine_runs    — one row per engine execution (audit / history)
--   • silvery_engine_results — one row per SKU per run
--
-- Both tables have RLS enabled: users can only read/write their own rows.
-- =============================================================================

-- ── 1. silvery_engine_runs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.silvery_engine_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  trigger       text        NOT NULL DEFAULT 'manual'
                            CHECK (trigger IN ('manual', 'scheduled')),
  status        text        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed')),
  skus_processed integer    NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.silvery_engine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own runs"
  ON public.silvery_engine_runs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own runs"
  ON public.silvery_engine_runs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own runs"
  ON public.silvery_engine_runs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

-- ── 2. silvery_engine_results ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.silvery_engine_results (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid        NOT NULL REFERENCES public.silvery_engine_runs(id) ON DELETE CASCADE,
  sku_id           uuid        REFERENCES public.skus(id) ON DELETE SET NULL,
  user_id          uuid        NOT NULL,
  sku_code         text,
  min_optimized    numeric,
  max_optimized    numeric,
  break_even_qty   numeric,
  break_even_value numeric,
  safety_stock     numeric,
  eoq              numeric,
  recommended_order numeric,
  status           text,
  days_of_cover    numeric,
  input_snapshot   jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.silvery_engine_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own results"
  ON public.silvery_engine_results FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own results"
  ON public.silvery_engine_results FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- ── 3. Helpful index for common look-up patterns ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_silvery_engine_runs_user_created
  ON public.silvery_engine_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_silvery_engine_results_run
  ON public.silvery_engine_results (run_id, sku_code);
