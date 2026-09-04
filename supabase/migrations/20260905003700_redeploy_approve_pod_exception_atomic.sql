-- Redeploy the hardened exception-approval RPC to databases that have already
-- applied the original atomic approval migration.
CREATE OR REPLACE FUNCTION public.approve_pod_exception_atomic(
  p_pod_id integer,
  p_approved_by integer,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_result jsonb;
BEGIN
  -- The service route resolves Supabase identities to the legacy operational
  -- users table. Recheck that server-supplied actor here because this
  -- SECURITY DEFINER function is the final authorization boundary.
  IF p_approved_by IS NULL OR p_approved_by <= 0 THEN
    RAISE EXCEPTION 'approved_by must be a positive operational user ID' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.users
  WHERE id = p_approved_by AND is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approved_by % is not an active operational user', p_approved_by
      USING ERRCODE = '23503';
  END IF;

  SELECT status INTO v_status
  FROM pod
  WHERE id = p_pod_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PoD % does not exist', p_pod_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('Pending', 'Exception') THEN
    RAISE EXCEPTION 'PoD % has already been processed (status: %)', p_pod_id, v_status
      USING ERRCODE = '55000';
  END IF;

  -- approve_pods_atomic only accepts Pending rows. An Exception is a pending
  -- delivery held for review, so return it to that guarded state inside this
  -- same transaction immediately before its atomic approval.
  UPDATE pod SET notes = p_notes, status = 'Pending' WHERE id = p_pod_id;
  PERFORM approve_pods_atomic(jsonb_build_array(p_pod_id), p_approved_by);

  SELECT to_jsonb(p) INTO v_result FROM pod p WHERE p.id = p_pod_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pod_exception_atomic(integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pod_exception_atomic(integer, integer, text)
  TO service_role;