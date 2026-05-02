
-- ==========================================
-- 1. Add missing columns to skus
-- ==========================================
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS stock numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS on_order numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS in_production numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS moq integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS service_level numeric DEFAULT 0.95,
  ADD COLUMN IF NOT EXISTS min_stock numeric,
  ADD COLUMN IF NOT EXISTS max_stock numeric,
  ADD COLUMN IF NOT EXISTS demand_history numeric[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS demand_history_yearly numeric[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS forecast_3m numeric[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_min_recommended numeric,
  ADD COLUMN IF NOT EXISTS ai_max_recommended numeric,
  ADD COLUMN IF NOT EXISTS ai_justification text,
  ADD COLUMN IF NOT EXISTS ai_optimized_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ==========================================
-- 2. Add missing columns to purchase_orders
-- ==========================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS sku_id uuid REFERENCES public.skus(id),
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS quantity numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS expected_at timestamptz,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ==========================================
-- 3. Trigger for updated_at on skus
-- ==========================================
CREATE OR REPLACE TRIGGER update_skus_updated_at
  BEFORE UPDATE ON public.skus
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for updated_at on purchase_orders
CREATE OR REPLACE TRIGGER update_po_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ==========================================
-- 4. RLS policies for tables missing them
-- ==========================================

-- profiles
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- companies — accessible via profiles
CREATE POLICY "Users access own company" ON public.companies FOR SELECT TO authenticated
  USING (id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- demand_history — via sku -> company
CREATE POLICY "Users access own demand_history" ON public.demand_history FOR ALL TO authenticated
  USING (sku_id IN (SELECT id FROM public.skus WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- forecasts
CREATE POLICY "Users access own forecasts" ON public.forecasts FOR ALL TO authenticated
  USING (sku_id IN (SELECT id FROM public.skus WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- inventory
CREATE POLICY "Users access own inventory" ON public.inventory FOR ALL TO authenticated
  USING (sku_id IN (SELECT id FROM public.skus WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- kpis
CREATE POLICY "Users access own kpis" ON public.kpis FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- recommendations
CREATE POLICY "Users access own recommendations" ON public.recommendations FOR ALL TO authenticated
  USING (sku_id IN (SELECT id FROM public.skus WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- supply
CREATE POLICY "Users access own supply" ON public.supply FOR ALL TO authenticated
  USING (sku_id IN (SELECT id FROM public.skus WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- purchase_order_items
CREATE POLICY "Users access own po_items" ON public.purchase_order_items FOR ALL TO authenticated
  USING (po_id IN (SELECT id FROM public.purchase_orders WHERE company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())));

-- purchase_orders — add user-scoped policy
CREATE POLICY "Users access own purchase_orders" ON public.purchase_orders FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

-- ==========================================
-- 5. Revoke anon EXECUTE on SECURITY DEFINER functions
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon;

-- Fix upload_file search_path
CREATE OR REPLACE FUNCTION public.upload_file(file_name text)
RETURNS void
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
begin
  return;
end;
$function$;
