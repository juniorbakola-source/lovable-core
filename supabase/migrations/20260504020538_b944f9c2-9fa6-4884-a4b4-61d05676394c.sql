
-- Clean orphan SKUs with no owner
DELETE FROM public.skus WHERE user_id IS NULL;

-- Revoke public EXECUTE on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM public, anon, authenticated;
