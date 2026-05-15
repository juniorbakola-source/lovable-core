
-- 1) SKUs: replace overly broad ALL policy with split policies enforcing company_id match
DROP POLICY IF EXISTS "Users manage own skus by user_id" ON public.skus;

CREATE POLICY "Users insert own company skus"
ON public.skus
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Users update own company skus"
ON public.skus
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
);

CREATE POLICY "Users delete own company skus"
ON public.skus
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
);

-- 2) contact_submissions: explicitly deny reads to authenticated role
DROP POLICY IF EXISTS "No public reads" ON public.contact_submissions;

CREATE POLICY "Block all reads for non-service role"
ON public.contact_submissions
FOR SELECT
TO anon, authenticated
USING (false);
