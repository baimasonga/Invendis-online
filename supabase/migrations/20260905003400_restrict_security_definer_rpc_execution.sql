-- SECURITY DEFINER functions receive EXECUTE for PUBLIC by default.
-- Keep transactional write RPCs server-only and keep the auth trigger private.

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.import_dispatch_manifest(
  text, integer, integer, text, integer, integer, text, text, integer, text,
  integer, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_dispatch_manifest(
  text, integer, integer, text, integer, integer, text, text, integer, text,
  integer, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.import_manifest_atomic(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_manifest_atomic(jsonb, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.submit_pod_atomic(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pod_atomic(jsonb, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.approve_pods_atomic(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pods_atomic(jsonb, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.approve_pod_exception_atomic(integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pod_exception_atomic(integer, integer, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.start_dispatch_atomic(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_dispatch_atomic(integer, integer)
  TO service_role;