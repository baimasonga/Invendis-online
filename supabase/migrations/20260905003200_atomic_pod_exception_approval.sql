-- Exception approval must use the same accounting path as normal approval.
-- Updating the exception note and invoking approve_pods_atomic inside this
-- function keeps both operations in one transaction.
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
  SELECT status INTO v_status
  FROM pod
  WHERE id = p_pod_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PoD % does not exist', p_pod_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'Pending' THEN
    RAISE EXCEPTION 'PoD % has already been processed (status: %)', p_pod_id, v_status
      USING ERRCODE = '55000';
  END IF;

  UPDATE pod SET notes = p_notes WHERE id = p_pod_id;
  PERFORM approve_pods_atomic(jsonb_build_array(p_pod_id), p_approved_by);

  SELECT to_jsonb(p) INTO v_result FROM pod p WHERE p.id = p_pod_id;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_pod_exception_atomic(integer, integer, text) TO service_role;