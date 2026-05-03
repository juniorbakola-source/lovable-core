
-- Delete duplicates, keeping the most recently updated row per (user_id, sku_code)
DELETE FROM public.skus
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, sku_code) id
  FROM public.skus
  ORDER BY user_id, sku_code, updated_at DESC NULLS LAST
);

-- Now add the unique constraint
ALTER TABLE public.skus ADD CONSTRAINT skus_user_id_sku_code_key UNIQUE (user_id, sku_code);
