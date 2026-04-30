-- Étendre la table skus pour Min/Max optimisé par IA
ALTER TABLE public.skus
  ADD COLUMN IF NOT EXISTS in_production integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demand_history_yearly numeric[] NOT NULL DEFAULT '{}'::numeric[],
  ADD COLUMN IF NOT EXISTS forecast_3m numeric[] NOT NULL DEFAULT '{}'::numeric[],
  ADD COLUMN IF NOT EXISTS min_stock integer,
  ADD COLUMN IF NOT EXISTS max_stock integer,
  ADD COLUMN IF NOT EXISTS ai_min_recommended integer,
  ADD COLUMN IF NOT EXISTS ai_max_recommended integer,
  ADD COLUMN IF NOT EXISTS ai_justification text,
  ADD COLUMN IF NOT EXISTS ai_optimized_at timestamp with time zone;

-- Table d'audit des runs d'optimisation IA
CREATE TABLE IF NOT EXISTS public.optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  skus_processed integer NOT NULL DEFAULT 0,
  skus_succeeded integer NOT NULL DEFAULT 0,
  model text,
  status text NOT NULL DEFAULT 'running',
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own runs" ON public.optimization_runs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own runs" ON public.optimization_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own runs" ON public.optimization_runs
  FOR UPDATE USING (auth.uid() = user_id);