CREATE OR REPLACE FUNCTION public.import_manifest_atomic(p_payload jsonb, p_created_by integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rows jsonb := p_payload->'rows';
  v_columns jsonb := p_payload->'columns';
  v_row jsonb; v_col jsonb;
  v_value_chain_id integer; v_campaign_id integer; v_warehouse_id integer;
  v_district_id integer; v_chiefdom_id integer; v_section_id integer; v_community_id integer;
  v_item_id integer; v_farmer_id integer; v_dispatch_id integer;
  v_item_map jsonb := '{}'::jsonb; v_district_map jsonb := '{}'::jsonb;
  v_chiefdom_map jsonb := '{}'::jsonb; v_community_map jsonb := '{}'::jsonb;
  v_farmer_ids integer[] := '{}'; v_dispatch_items jsonb := '[]'::jsonb;
  v_communities jsonb := '[]'::jsonb; v_dispatch jsonb;
  v_title text; v_vc_name text; v_name text; v_key text; v_phone text;
  v_campaign_name text; v_manifest_code text; v_farmer_code text; v_barcode text;
  v_first text; v_last text; v_qty double precision; v_total double precision := 0;
  v_items_created integer := 0; v_farmers_created integer := 0; v_pos integer;
  v_shortfalls jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) = 0
     OR jsonb_typeof(v_columns) <> 'array' OR jsonb_array_length(v_columns) = 0 THEN
    RAISE EXCEPTION 'rows and columns are required' USING ERRCODE = '22023';
  END IF;
  v_warehouse_id := (p_payload->>'warehouseId')::integer;
  PERFORM 1 FROM warehouses WHERE id = v_warehouse_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % does not exist', v_warehouse_id USING ERRCODE = '23503'; END IF;

  v_title := COALESCE(p_payload->>'notes', p_payload->>'newCampaignName', '');
  v_vc_name := initcap((regexp_match(v_title, '\mfor\s+(\w+)\s+communities\M', 'i'))[1]);
  IF v_vc_name IS NOT NULL THEN
    SELECT id INTO v_value_chain_id FROM value_chains WHERE lower(name)=lower(v_vc_name) LIMIT 1;
    IF v_value_chain_id IS NULL THEN
      INSERT INTO value_chains(name,is_active) VALUES(v_vc_name,1) RETURNING id INTO v_value_chain_id;
    END IF;
  END IF;
  IF v_value_chain_id IS NULL THEN SELECT id INTO v_value_chain_id FROM value_chains ORDER BY id LIMIT 1; END IF;

  FOR v_col IN SELECT value FROM jsonb_array_elements(v_columns)
  LOOP
    IF v_col->>'itemId' IS NOT NULL AND v_col->>'itemId' <> '' THEN
      v_item_id := (v_col->>'itemId')::integer;
      PERFORM 1 FROM input_items WHERE id=v_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'input item % does not exist', v_item_id USING ERRCODE='23503'; END IF;
    ELSE
      v_name := btrim(regexp_replace(COALESCE(v_col->>'name',''), '[*†‡§]+$', ''));
      IF v_name='' THEN RAISE EXCEPTION 'input item name is required' USING ERRCODE='22023'; END IF;
      SELECT id INTO v_item_id FROM input_items WHERE lower(name)=lower(v_name) LIMIT 1;
      IF v_item_id IS NULL THEN
        INSERT INTO input_items(item_code,name,unit,category,is_active)
        VALUES('ITM-'||upper(substr(md5(random()::text),1,8)),v_name,COALESCE(NULLIF(v_col->>'unit',''),'pcs'),'Tools',1)
        RETURNING id INTO v_item_id;
        v_items_created := v_items_created+1;
      END IF;
    END IF;
    v_item_map := v_item_map || jsonb_build_object(v_col->>'colIndex',v_item_id);
    INSERT INTO stock_balance(warehouse_id,input_item_id,available,reserved,loaded,delivered,returned,damaged)
    VALUES(v_warehouse_id,v_item_id,0,0,0,0,0,0) ON CONFLICT(warehouse_id,input_item_id) DO NOTHING;
  END LOOP;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    v_name := btrim(COALESCE(v_row->>'district',''));
    IF v_name='' THEN RAISE EXCEPTION 'district is required' USING ERRCODE='22023'; END IF;
    v_key := lower(v_name);
    v_district_id := (v_district_map->>v_key)::integer;
    IF v_district_id IS NULL THEN
      SELECT id INTO v_district_id FROM districts WHERE lower(name)=v_key LIMIT 1;
      IF v_district_id IS NULL THEN
        INSERT INTO districts(name,code) VALUES(v_name,upper(substr(v_name,1,3))||'-'||upper(substr(md5(random()::text),1,4)))
        RETURNING id INTO v_district_id;
      END IF;
      v_district_map := v_district_map||jsonb_build_object(v_key,v_district_id);
    END IF;
    v_name := btrim(COALESCE(v_row->>'chiefdom',''));
    v_chiefdom_id := NULL;
    IF v_name<>'' THEN
      v_key := lower(v_name)||'|'||v_district_id;
      v_chiefdom_id := (v_chiefdom_map->>v_key)::integer;
      IF v_chiefdom_id IS NULL THEN
        SELECT id INTO v_chiefdom_id FROM chiefdoms WHERE lower(name)=lower(v_name) AND district_id=v_district_id LIMIT 1;
        IF v_chiefdom_id IS NULL THEN INSERT INTO chiefdoms(name,district_id) VALUES(v_name,v_district_id) RETURNING id INTO v_chiefdom_id; END IF;
        v_chiefdom_map := v_chiefdom_map||jsonb_build_object(v_key,v_chiefdom_id);
      END IF;
    END IF;
    v_name := btrim(COALESCE(v_row->>'community',''));
    IF v_name='' THEN RAISE EXCEPTION 'community is required' USING ERRCODE='22023'; END IF;
    v_key := lower(v_name)||'|'||v_district_id;
    v_community_id := (v_community_map->>v_key)::integer;
    IF v_community_id IS NULL THEN
      SELECT c.id INTO v_community_id FROM communities c JOIN sections s ON s.id=c.section_id
      JOIN chiefdoms ch ON ch.id=s.chiefdom_id WHERE lower(c.name)=lower(v_name) AND ch.district_id=v_district_id LIMIT 1;
      IF v_community_id IS NULL AND v_chiefdom_id IS NOT NULL THEN
        SELECT id INTO v_section_id FROM sections WHERE chiefdom_id=v_chiefdom_id ORDER BY id LIMIT 1;
        IF v_section_id IS NULL THEN INSERT INTO sections(name,chiefdom_id) VALUES(COALESCE(NULLIF(v_row->>'chiefdom',''),'Default'),v_chiefdom_id) RETURNING id INTO v_section_id; END IF;
        INSERT INTO communities(name,section_id) VALUES(v_name,v_section_id) RETURNING id INTO v_community_id;
      END IF;
      IF v_community_id IS NOT NULL THEN v_community_map:=v_community_map||jsonb_build_object(v_key,v_community_id); END IF;
    END IF;
  END LOOP;

  v_campaign_id := NULLIF(p_payload->>'campaignId','')::integer;
  IF v_campaign_id IS NOT NULL THEN
    PERFORM 1 FROM campaigns WHERE id=v_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign % does not exist',v_campaign_id USING ERRCODE='23503'; END IF;
  ELSE
    v_campaign_name := COALESCE(NULLIF(btrim(p_payload->>'newCampaignName'),''),NULLIF(btrim(p_payload->>'notes'),''),'Distribution - '||to_char(current_date,'DD/MM/YYYY'));
    SELECT id INTO v_campaign_id FROM campaigns WHERE name=v_campaign_name LIMIT 1;
    IF v_campaign_id IS NULL THEN
      SELECT (value->>'district') INTO v_name FROM jsonb_array_elements(v_rows) LIMIT 1;
      v_district_id := (v_district_map->>lower(btrim(v_name)))::integer;
      INSERT INTO campaigns(campaign_code,name,district_id,value_chain_id,start_date,end_date,status,created_by)
      VALUES('CAM-'||upper(substr(md5(random()::text),1,8)),v_campaign_name,v_district_id,v_value_chain_id,current_date,current_date+180,'approved',p_created_by)
      RETURNING id INTO v_campaign_id;
    END IF;
    PERFORM 1 FROM campaigns WHERE id=v_campaign_id FOR UPDATE;
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    v_name:=btrim(v_row->>'community'); v_district_id:=(v_district_map->>lower(btrim(v_row->>'district')))::integer;
    v_chiefdom_id:=(v_chiefdom_map->>(lower(btrim(COALESCE(v_row->>'chiefdom','')))||'|'||v_district_id))::integer;
    v_community_id:=(v_community_map->>(lower(v_name)||'|'||v_district_id))::integer;
    v_phone:=NULLIF(v_row->>'contactPhone','');
    SELECT id,farmer_code,barcode_token INTO v_farmer_id,v_farmer_code,v_barcode FROM farmers WHERE farmer_group=v_name LIMIT 1;
    IF v_farmer_id IS NULL THEN
      v_farmer_code:='FMR-'||upper(substr(md5(random()::text),1,8)); v_barcode:='BC-'||upper(substr(md5(random()::text),1,10));
      v_first:=split_part(COALESCE(NULLIF(btrim(v_row->>'contactPerson'),''),v_name),' ',1);
      v_last:=NULLIF(btrim(substr(COALESCE(v_row->>'contactPerson',''),length(v_first)+1)),''); v_last:=COALESCE(v_last,'Beneficiary');
      INSERT INTO farmers(farmer_group,first_name,last_name,gender,value_chain_id,district_id,chiefdom_id,community_id,phone,farmer_code,barcode_token,status,registered_by,beneficiary_type)
      VALUES(v_name,v_first,v_last,'unknown',v_value_chain_id,v_district_id,v_chiefdom_id,v_community_id,v_phone,v_farmer_code,v_barcode,'pending',p_created_by,'group')
      RETURNING id INTO v_farmer_id; v_farmers_created:=v_farmers_created+1;
    ELSE
      UPDATE farmers SET beneficiary_type='group',phone=COALESCE(phone,v_phone),chiefdom_id=COALESCE(chiefdom_id,v_chiefdom_id),community_id=COALESCE(v_community_id,community_id) WHERE id=v_farmer_id;
    END IF;
    v_farmer_ids:=array_append(v_farmer_ids,v_farmer_id);
    v_communities:=v_communities||jsonb_build_array(jsonb_build_object('community',v_name,'district',btrim(v_row->>'district'),'farmerCode',v_farmer_code,'barcodeToken',v_barcode));
  END LOOP;

  FOR v_col,v_pos IN SELECT value,ordinality::integer FROM jsonb_array_elements(v_columns) WITH ORDINALITY
  LOOP
    v_item_id:=(v_item_map->>(v_col->>'colIndex'))::integer; v_qty:=0;
    SELECT COALESCE(sum(GREATEST(0,COALESCE((r.value->'quantities'->>(v_pos-1))::double precision,0))),0) INTO v_qty FROM jsonb_array_elements(v_rows) r;
    IF v_qty>0 THEN v_dispatch_items:=v_dispatch_items||jsonb_build_array(jsonb_build_object('input_item_id',v_item_id,'quantity_loaded',v_qty)); v_total:=v_total+v_qty; END IF;
  END LOOP;
  IF jsonb_array_length(v_dispatch_items)=0 THEN RAISE EXCEPTION 'manifest requires positive item quantities' USING ERRCODE='22023'; END IF;
  IF NOT COALESCE((p_payload->>'force')::boolean,false) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('itemName',i.name,'needed',x.qty,'available',COALESCE(sb.available,0))),'[]'::jsonb)
    INTO v_shortfalls FROM (SELECT (value->>'input_item_id')::integer id,(value->>'quantity_loaded')::double precision qty FROM jsonb_array_elements(v_dispatch_items)) x
    JOIN input_items i ON i.id=x.id LEFT JOIN stock_balance sb ON sb.warehouse_id=v_warehouse_id AND sb.input_item_id=x.id WHERE x.qty>COALESCE(sb.available,0);
    IF jsonb_array_length(v_shortfalls)>0 THEN RAISE EXCEPTION 'insufficient_stock: %',v_shortfalls USING ERRCODE='P0001'; END IF;
  END IF;

  INSERT INTO allocations(campaign_id,farmer_id,notes,allocated_by)
  SELECT v_campaign_id,id,'Imported from Excel manifest',p_created_by FROM unnest(v_farmer_ids) id
  WHERE NOT EXISTS(SELECT 1 FROM allocations a WHERE a.campaign_id=v_campaign_id AND a.farmer_id=id);
  v_manifest_code:='MAN-'||upper(substr(md5(clock_timestamp()::text||random()::text),1,12));
  INSERT INTO dispatches(manifest_code,campaign_id,warehouse_id,vehicle_type,vehicle_id,driver_id,hired_plate,hired_driver_name,field_officer_id,notes,created_by,total_packages)
  VALUES(v_manifest_code,v_campaign_id,v_warehouse_id,COALESCE(p_payload->>'vehicleType','office'),
    CASE WHEN p_payload->>'vehicleType'='hired' THEN NULL ELSE NULLIF(p_payload->>'vehicleId','')::integer END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN NULL ELSE NULLIF(p_payload->>'driverId','')::integer END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN upper(p_payload->>'hiredPlate') END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN p_payload->>'hiredDriverName' END,
    NULLIF(p_payload->>'fieldOfficerId','')::integer,p_payload->>'notes',p_created_by,round(v_total)::integer)
  RETURNING dispatches.id,to_jsonb(dispatches) INTO v_dispatch_id,v_dispatch;
  INSERT INTO dispatch_items(dispatch_id,input_item_id,quantity_loaded)
  SELECT v_dispatch_id,(value->>'input_item_id')::integer,(value->>'quantity_loaded')::double precision FROM jsonb_array_elements(v_dispatch_items);
  RETURN jsonb_build_object('dispatch',v_dispatch,'manifestCode',v_manifest_code,'campaignId',v_campaign_id,'campaignName',v_campaign_name,
    'itemsCreated',v_items_created,'farmersCreated',v_farmers_created,'totalCommunities',jsonb_array_length(v_rows),'communities',v_communities);
END $$;

GRANT EXECUTE ON FUNCTION public.import_manifest_atomic(jsonb,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_pod_atomic(p_record jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pod pod%ROWTYPE; v_dispatch_id integer; v_item record; v_manifest record;
  v_requested jsonb := '[]'::jsonb; v_pending double precision; v_remaining double precision;
  v_dispatch_status text;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'items must be an array' USING ERRCODE='22023'; END IF;
  v_dispatch_id:=NULLIF(p_record->>'dispatch_id','')::integer;
  IF v_dispatch_id IS NOT NULL THEN
    -- Match start_dispatch_atomic's lock order: dispatch first, then manifest
    -- item rows. This also prevents a submit racing a lifecycle transition.
    SELECT status INTO v_dispatch_status
    FROM dispatches
    WHERE id=v_dispatch_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'dispatch % does not exist',v_dispatch_id USING ERRCODE='23503'; END IF;
    IF v_dispatch_status NOT IN ('In Transit', 'Arrived') THEN
      RAISE EXCEPTION 'dispatch % cannot accept deliveries from status %',v_dispatch_id,v_dispatch_status
        USING ERRCODE='55000';
    END IF;
    IF jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'dispatch delivery requires items' USING ERRCODE='22023'; END IF;
    -- Row locks serialize concurrent submissions for this dispatch. A waiter
    -- rechecks pending reservations after the earlier transaction commits.
    PERFORM 1 FROM dispatch_items WHERE dispatch_id=v_dispatch_id ORDER BY id FOR UPDATE;
    FOR v_item IN
      SELECT input_item_id,sum(quantity_delivered) quantity
      FROM jsonb_to_recordset(p_items) x(input_item_id integer,quantity_delivered double precision)
      GROUP BY input_item_id
    LOOP
      IF v_item.input_item_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity<=0
         OR v_item.quantity IN ('Infinity'::float8,'-Infinity'::float8,'NaN'::float8) THEN
        RAISE EXCEPTION 'items require positive finite quantities' USING ERRCODE='22023';
      END IF;
      SELECT quantity_loaded,COALESCE(quantity_delivered,0) INTO v_manifest
      FROM dispatch_items WHERE dispatch_id=v_dispatch_id AND input_item_id=v_item.input_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'input item % is not on dispatch %',v_item.input_item_id,v_dispatch_id USING ERRCODE='23503'; END IF;
      SELECT COALESCE(sum(qty),0) INTO v_pending FROM (
        SELECT pi.quantity_delivered qty FROM pod p JOIN pod_items pi ON pi.pod_id=p.id
        WHERE p.dispatch_id=v_dispatch_id AND p.status='Pending' AND pi.input_item_id=v_item.input_item_id
        UNION ALL
        SELECT p.quantity_delivered FROM pod p
        WHERE p.dispatch_id=v_dispatch_id AND p.status='Pending' AND p.input_item_id=v_item.input_item_id
          AND NOT EXISTS(SELECT 1 FROM pod_items pi WHERE pi.pod_id=p.id)
      ) reserved;
      v_remaining:=v_manifest.quantity_loaded-v_manifest.quantity_delivered-v_pending;
      IF v_item.quantity>v_remaining THEN
        RAISE EXCEPTION 'quantity for item % exceeds remaining dispatch quantity %',v_item.input_item_id,GREATEST(0,v_remaining) USING ERRCODE='22023';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO pod(
    dispatch_id,campaign_id,farmer_id,input_item_id,input_barcode,quantity_delivered,
    farmer_latitude,farmer_longitude,face_status,notes,override_reason,otp_status,
    otp_verified,pod_code,status,gps_status,submitted_at,field_officer_id,
    photo_keys,photo_gps_coords,vehicle_gps_snapshot,face_photo_key,face_similarity,otp_code
  ) VALUES (
    v_dispatch_id,NULLIF(p_record->>'campaign_id','')::integer,NULLIF(p_record->>'farmer_id','')::integer,
    NULLIF(p_record->>'input_item_id','')::integer,p_record->>'input_barcode',NULLIF(p_record->>'quantity_delivered','')::double precision,
    NULLIF(p_record->>'farmer_latitude','')::double precision,NULLIF(p_record->>'farmer_longitude','')::double precision,
    p_record->>'face_status',p_record->>'notes',p_record->>'override_reason',p_record->>'otp_status',
    COALESCE((p_record->>'otp_verified')::boolean,false),p_record->>'pod_code',p_record->>'status',p_record->>'gps_status',
    NULLIF(p_record->>'submitted_at','')::timestamptz,NULLIF(p_record->>'field_officer_id','')::integer,
    p_record->'photo_keys',p_record->'photo_gps_coords',p_record->'vehicle_gps_snapshot',
    p_record->>'face_photo_key',NULLIF(p_record->>'face_similarity','')::double precision,p_record->>'otp_code'
  ) RETURNING * INTO v_pod;
  INSERT INTO pod_items(pod_id,input_item_id,quantity_delivered)
  SELECT v_pod.id,input_item_id,quantity_delivered
  FROM jsonb_to_recordset(p_items) x(input_item_id integer,quantity_delivered double precision);
  RETURN to_jsonb(v_pod);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_pod_atomic(jsonb,jsonb) TO service_role;