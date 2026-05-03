-- ============================================================
-- SSOT Architecture — Gestion SKUs as Single Source of Truth
-- ============================================================

-- -------------------------------------------------------
-- 1. sku_import_logs — track every import (CSV / manual / connector)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sku_import_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  source_type   text NOT NULL CHECK (source_type IN ('csv','manual','connector','elka')),
  connector_id  uuid,
  file_name     text,
  rows_submitted integer NOT NULL DEFAULT 0,
  rows_inserted  integer NOT NULL DEFAULT 0,
  rows_updated   integer NOT NULL DEFAULT 0,
  rows_failed    integer NOT NULL DEFAULT 0,
  errors        jsonb,
  status        text NOT NULL DEFAULT 'success' CHECK (status IN ('success','partial','failed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sku_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own import logs" ON public.sku_import_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own import logs" ON public.sku_import_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_import_logs_user ON public.sku_import_logs(user_id);
CREATE INDEX idx_import_logs_created ON public.sku_import_logs(created_at DESC);

-- -------------------------------------------------------
-- 2. sku_change_history — audit log for every SKU mutation
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sku_change_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id      uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('csv','manual','connector','elka','ai','system')),
  operation   text NOT NULL CHECK (operation IN ('insert','update','delete')),
  before_data jsonb,
  after_data  jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sku_change_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own sku change history" ON public.sku_change_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sku change history" ON public.sku_change_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_sku_change_sku_id ON public.sku_change_history(sku_id);
CREATE INDEX idx_sku_change_user ON public.sku_change_history(user_id);
CREATE INDEX idx_sku_change_changed_at ON public.sku_change_history(changed_at DESC);

-- -------------------------------------------------------
-- 3. silvery_engine_runs — metadata per engine execution
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.silvery_engine_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  trigger         text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','scheduled')),
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  skus_processed  integer NOT NULL DEFAULT 0,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

ALTER TABLE public.silvery_engine_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own engine runs" ON public.silvery_engine_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own engine runs" ON public.silvery_engine_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own engine runs" ON public.silvery_engine_runs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_engine_runs_user ON public.silvery_engine_runs(user_id);
CREATE INDEX idx_engine_runs_created ON public.silvery_engine_runs(created_at DESC);

-- -------------------------------------------------------
-- 4. silvery_engine_results — per-SKU results per run
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.silvery_engine_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES public.silvery_engine_runs(id) ON DELETE CASCADE,
  sku_id              uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  sku_code            text,
  -- Computed values
  min_optimized       numeric,
  max_optimized       numeric,
  break_even_qty      numeric,
  break_even_value    numeric,
  safety_stock        numeric,
  eoq                 numeric,
  recommended_order   numeric,
  status              text CHECK (status IN ('ok','low','critical','overstock')),
  days_of_cover       numeric,
  -- Input snapshot for audit / explainability
  input_snapshot      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.silvery_engine_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own engine results" ON public.silvery_engine_results
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own engine results" ON public.silvery_engine_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_engine_results_run ON public.silvery_engine_results(run_id);
CREATE INDEX idx_engine_results_sku ON public.silvery_engine_results(sku_id);
CREATE INDEX idx_engine_results_user ON public.silvery_engine_results(user_id);
CREATE INDEX idx_engine_results_created ON public.silvery_engine_results(created_at DESC);

-- -------------------------------------------------------
-- 5. connectors — external data source configurations
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.connectors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  name            text NOT NULL,
  connector_type  text NOT NULL DEFAULT 'http_api' CHECK (connector_type IN ('http_api','sql','erp_generic')),
  config          jsonb NOT NULL DEFAULT '{}',
  field_mappings  jsonb NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  last_sync_status text,
  last_sync_rows  integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own connectors" ON public.connectors
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own connectors" ON public.connectors
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own connectors" ON public.connectors
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own connectors" ON public.connectors
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_connectors_user ON public.connectors(user_id);

CREATE TRIGGER update_connectors_updated_at
  BEFORE UPDATE ON public.connectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -------------------------------------------------------
-- 6. Unique constraint on skus (user_id, sku_code) for upserts
--    (may already exist; use IF NOT EXISTS pattern via DO block)
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'skus_user_id_sku_code_key'
      AND conrelid = 'public.skus'::regclass
  ) THEN
    ALTER TABLE public.skus ADD CONSTRAINT skus_user_id_sku_code_key UNIQUE (user_id, sku_code);
  END IF;
END$$;
