-- Table purchase_orders
CREATE TABLE public.purchase_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sku_id UUID NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','in_transit','received','cancelled')),
  ordered_at TIMESTAMPTZ,
  expected_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_user ON public.purchase_orders(user_id);
CREATE INDEX idx_po_sku ON public.purchase_orders(sku_id);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own POs" ON public.purchase_orders
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own POs" ON public.purchase_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own POs" ON public.purchase_orders
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own POs" ON public.purchase_orders
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_po_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();