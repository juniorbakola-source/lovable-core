
-- SKUs table (multi-tenant, per-user)
CREATE TABLE public.skus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  on_order INTEGER NOT NULL DEFAULT 0 CHECK (on_order >= 0),
  lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days > 0),
  moq INTEGER NOT NULL DEFAULT 1 CHECK (moq >= 0),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  service_level NUMERIC(4,3) NOT NULL DEFAULT 0.95 CHECK (service_level > 0 AND service_level < 1),
  demand_history NUMERIC[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, sku_code)
);

ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own skus" ON public.skus FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own skus" ON public.skus FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own skus" ON public.skus FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own skus" ON public.skus FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_skus_updated_at
BEFORE UPDATE ON public.skus
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_skus_user_id ON public.skus(user_id);
