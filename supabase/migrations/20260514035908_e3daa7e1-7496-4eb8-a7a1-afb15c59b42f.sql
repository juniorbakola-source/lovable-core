-- 1. Drop SKU policies that target the broad 'public' role and replace with authenticated-only equivalents
DROP POLICY IF EXISTS "Users can access their company data" ON public.skus;
DROP POLICY IF EXISTS "Users delete own skus" ON public.skus;
DROP POLICY IF EXISTS "Users insert own skus" ON public.skus;
DROP POLICY IF EXISTS "Users update own skus" ON public.skus;
DROP POLICY IF EXISTS "Users view own skus" ON public.skus;

-- The remaining "Users manage own skus by user_id" policy already covers ALL operations
-- for authenticated users scoped by user_id. We additionally re-add a company-scoped
-- read policy restricted to authenticated users.
CREATE POLICY "Authenticated users access own company skus"
ON public.skus
FOR SELECT
TO authenticated
USING (
  company_id IN (
    SELECT profiles.company_id FROM public.profiles WHERE profiles.id = auth.uid()
  )
);

-- 2. Add an explicit no-access policy on 'Contrôle Réception' (no use-case yet, lock it down)
CREATE POLICY "No access by default"
ON public."Contrôle Réception"
FOR SELECT
TO authenticated
USING (false);
