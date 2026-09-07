-- Migration 04200 had already been applied before the concurrent-retry race was
-- discovered. Replace the submitter in a forward migration so existing
-- environments receive the same implementation exercised by fresh installs.
CREATE OR REPLACE FUNCTION public.submit_pod_atomic(p_record jsonb, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pod pod%ROWTYPE; v_existing pod%ROWTYPE; v_dispatch_id integer; v_item record; v_manifest record;
  v_requested jsonb := '[]'::jsonb; v_pending double precision; v_remaining double precision;
  v_dispatch_status text; v_dispatch_campaign_id integer; v_submission_key text := NULLIF(p_record->>'submission_key','');
  v_otp_hash text := NULLIF(p_record->>'otp_verification_hash',''); v_face_hash text := NULLIF(p_record->>'face_verification_hash','');
  v_otp_status text := 'Pending'; v_otp_verified boolean := false; v_face_status text := 'Pending'; v_face_similarity double precision; v_proof record;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items must be an array' USING ERRCODE='22023'; END IF;
  IF v_submission_key IS NOT NULL THEN
    -- Serialize retries before proof rows are inspected or consumed. The
    -- unique index remains the final integrity backstop.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_submission_key, 0));
    SELECT * INTO v_existing FROM pod WHERE submission_key = v_submission_key FOR UPDATE;
    IF FOUND THEN RETURN to_jsonb(v_existing); END IF;
  END IF;
  v_dispatch_id:=NULLIF(p_record->>'dispatch_id','')::integer;
  IF v_dispatch_id IS NOT NULL THEN
    SELECT status, campaign_id INTO v_dispatch_status, v_dispatch_campaign_id FROM dispatches WHERE id=v_dispatch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch % does not exist',v_dispatch_id USING ERRCODE='23503'; END IF;
    IF v_dispatch_status NOT IN ('In Transit', 'Arrived') THEN RAISE EXCEPTION 'dispatch % cannot accept deliveries from status %',v_dispatch_id,v_dispatch_status USING ERRCODE='55000'; END IF;
    IF jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'dispatch delivery requires items' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM dispatch_items WHERE dispatch_id=v_dispatch_id ORDER BY id FOR UPDATE;
    FOR v_item IN SELECT input_item_id,sum(quantity_delivered) quantity FROM jsonb_to_recordset(p_items) x(input_item_id integer,quantity_delivered double precision) GROUP BY input_item_id LOOP
      IF v_item.input_item_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0 OR v_item.quantity IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) THEN RAISE EXCEPTION 'items require positive finite quantities' USING ERRCODE='22023'; END IF;
      SELECT di.quantity_loaded,COALESCE(di.quantity_delivered,0) AS quantity_delivered INTO v_manifest FROM dispatch_items di WHERE di.dispatch_id=v_dispatch_id AND di.input_item_id=v_item.input_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'input item % is not on dispatch %',v_item.input_item_id,v_dispatch_id USING ERRCODE='23503'; END IF;
      SELECT COALESCE(sum(qty),0) INTO v_pending FROM (SELECT pi.quantity_delivered qty FROM pod p JOIN pod_items pi ON pi.pod_id=p.id WHERE p.dispatch_id=v_dispatch_id AND p.status='Pending' AND pi.input_item_id=v_item.input_item_id UNION ALL SELECT p.quantity_delivered FROM pod p WHERE p.dispatch_id=v_dispatch_id AND p.status='Pending' AND p.input_item_id=v_item.input_item_id AND NOT EXISTS(SELECT 1 FROM pod_items pi WHERE pi.pod_id=p.id)) reserved;
      v_remaining:=v_manifest.quantity_loaded-v_manifest.quantity_delivered-v_pending;
      IF v_item.quantity>v_remaining THEN RAISE EXCEPTION 'quantity for item % exceeds remaining dispatch quantity %',v_item.input_item_id,GREATEST(0,v_remaining) USING ERRCODE='22023'; END IF;
    END LOOP;
  END IF;
  IF v_otp_hash IS NOT NULL THEN
    SELECT * INTO v_proof FROM pod_verification_proofs
    WHERE token_hash=v_otp_hash AND kind='otp' AND farmer_id=NULLIF(p_record->>'farmer_id','')::integer
      AND dispatch_id=v_dispatch_id AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid, expired, or already used OTP verification proof' USING ERRCODE='22023'; END IF;
    v_otp_status:=v_proof.status; v_otp_verified:=v_proof.status='Verified';
  END IF;
  IF v_face_hash IS NOT NULL THEN
    SELECT * INTO v_proof FROM pod_verification_proofs
    WHERE token_hash=v_face_hash AND kind='face' AND farmer_id=NULLIF(p_record->>'farmer_id','')::integer
      AND dispatch_id=v_dispatch_id AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid, expired, or already used face verification proof' USING ERRCODE='22023'; END IF;
    v_face_status:=v_proof.status; v_face_similarity:=v_proof.similarity;
  END IF;
  BEGIN
    INSERT INTO pod(dispatch_id,campaign_id,farmer_id,input_item_id,input_barcode,quantity_delivered,farmer_latitude,farmer_longitude,face_status,notes,override_reason,otp_status,otp_verified,pod_code,status,gps_status,submitted_at,field_officer_id,photo_keys,photo_gps_coords,vehicle_gps_snapshot,face_photo_key,face_similarity,otp_code,submission_key)
    VALUES (v_dispatch_id,COALESCE(v_dispatch_campaign_id,NULLIF(p_record->>'campaign_id','')::integer),NULLIF(p_record->>'farmer_id','')::integer,NULLIF(p_record->>'input_item_id','')::integer,p_record->>'input_barcode',NULLIF(p_record->>'quantity_delivered','')::double precision,NULLIF(p_record->>'farmer_latitude','')::double precision,NULLIF(p_record->>'farmer_longitude','')::double precision,v_face_status,p_record->>'notes',p_record->>'override_reason',v_otp_status,v_otp_verified,p_record->>'pod_code',p_record->>'status',p_record->>'gps_status',NULLIF(p_record->>'submitted_at','')::timestamptz,NULLIF(p_record->>'field_officer_id','')::integer,p_record->'photo_keys',p_record->'photo_gps_coords',p_record->'vehicle_gps_snapshot',p_record->>'face_photo_key',v_face_similarity,NULL,v_submission_key)
    RETURNING * INTO v_pod;
  EXCEPTION WHEN unique_violation THEN
    IF v_submission_key IS NOT NULL THEN SELECT * INTO v_pod FROM pod WHERE submission_key=v_submission_key; IF FOUND THEN RETURN to_jsonb(v_pod); END IF; END IF;
    RAISE;
  END;
  UPDATE pod_verification_proofs SET consumed_at=now(), submission_key=v_submission_key
  WHERE token_hash IN (v_otp_hash, v_face_hash) AND consumed_at IS NULL;
  INSERT INTO pod_items(pod_id,input_item_id,quantity_delivered) SELECT v_pod.id,input_item_id,quantity_delivered FROM jsonb_to_recordset(p_items) x(input_item_id integer,quantity_delivered double precision);
  RETURN to_jsonb(v_pod);
END $$;

REVOKE ALL ON FUNCTION public.submit_pod_atomic(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pod_atomic(jsonb,jsonb) TO service_role;