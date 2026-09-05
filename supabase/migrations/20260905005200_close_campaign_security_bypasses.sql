-- Close campaign reservation, district-read, and manifest-import bypasses.
-- This follow-up is safe whether 05100 was applied before or after its fix.

BEGIN;

CREATE OR REPLACE FUNCTION private.invendis_can_read_campaign(p_campaign_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.campaigns c ON c.id = p_campaign_id
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND lower(regexp_replace(p.role, '[\s_-]', '', 'g')) = ANY (
        ARRAY['admin','projectmanager','districtcoordinator','warehousemanager','viewer']
      )
      AND (
        lower(regexp_replace(p.role, '[\s_-]', '', 'g')) <> 'districtcoordinator'
        OR (p.district_id IS NOT NULL AND c.district_id = p.district_id)
      )
  );
$$;
REVOKE ALL ON FUNCTION private.invendis_can_read_campaign(integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.invendis_can_read_campaign(integer)
  TO authenticated;

-- PostgreSQL combines permissive SELECT policies with OR. Remove every old
-- SELECT policy on these tables before adding the district-aware policy.
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY['campaigns','campaign_items','allocations'])
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END $$;

CREATE POLICY campaign_district_read ON public.campaigns
FOR SELECT TO authenticated
USING ((SELECT private.invendis_can_read_campaign(id)));

CREATE POLICY campaign_item_district_read ON public.campaign_items
FOR SELECT TO authenticated
USING ((SELECT private.invendis_can_read_campaign(campaign_id)));

CREATE POLICY allocation_district_read ON public.allocations
FOR SELECT TO authenticated
USING ((SELECT private.invendis_can_read_campaign(campaign_id)));

CREATE OR REPLACE FUNCTION public.enforce_campaign_dispatch_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c public.campaigns%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id=NEW.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;

  IF TG_OP='INSERT' OR NEW.status IN ('Approved','In Transit')
     OR (TG_OP='UPDATE' AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) THEN
    IF lower(c.status) NOT IN ('approved','active') THEN
      RAISE EXCEPTION 'Dispatch requires an Approved or Active campaign';
    END IF;
  END IF;
  IF c.source_warehouse_id IS NULL OR NEW.warehouse_id<>c.source_warehouse_id THEN
    RAISE EXCEPTION 'Dispatch warehouse must match the campaign source warehouse';
  END IF;

  IF NEW.status='In Transit'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM r.id
    FROM public.campaign_stock_reservations r
    WHERE r.campaign_id=NEW.campaign_id
    ORDER BY r.input_item_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Campaign has no active stock reservation';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT di.input_item_id, sum(di.quantity_loaded) AS quantity_loaded
        FROM public.dispatch_items di
        WHERE di.dispatch_id=NEW.id
        GROUP BY di.input_item_id
      ) di
      LEFT JOIN public.campaign_stock_reservations r
        ON r.campaign_id=NEW.campaign_id
       AND r.input_item_id=di.input_item_id
      WHERE r.id IS NULL OR di.quantity_loaded>r.reserved_quantity
    ) THEN
      RAISE EXCEPTION 'Dispatch quantities exceed the campaign stock reservation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_campaign_dispatch_integrity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_campaign_dispatch_integrity()
  TO service_role;

CREATE OR REPLACE FUNCTION public.activate_campaign_on_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status='In Transit' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.campaigns
       SET status='Active', updated_at=now()
     WHERE id=NEW.campaign_id AND lower(status)='approved';

    UPDATE public.campaign_stock_reservations r
       SET reserved_quantity=greatest(0,r.reserved_quantity-di.quantity_loaded),
           updated_at=now()
      FROM (
        SELECT input_item_id, sum(quantity_loaded) AS quantity_loaded
        FROM public.dispatch_items
        WHERE dispatch_id=NEW.id
        GROUP BY input_item_id
      ) di
     WHERE r.campaign_id=NEW.campaign_id
       AND r.input_item_id=di.input_item_id;
    -- Do not delete exhausted rows. Zero is the durable marker that blocks a
    -- second dispatch from treating the campaign as unreserved.
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.activate_campaign_on_dispatch()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_campaign_on_dispatch()
  TO service_role;

-- A manifest is now only a dispatch plan for an existing, approved campaign.
-- It cannot create campaigns, items, farmers, or allocations.
CREATE OR REPLACE FUNCTION public.import_campaign_manifest_atomic(
  p_payload jsonb,
  p_created_by integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb := p_payload->'rows';
  v_columns jsonb := p_payload->'columns';
  v_campaign public.campaigns%ROWTYPE;
  v_campaign_id integer;
  v_warehouse_id integer;
  v_dispatch_id integer;
  v_manifest_code text;
  v_total double precision;
  v_dispatch jsonb;
  v_communities jsonb;
  v_shortfalls jsonb;
  v_reservation_shortfalls jsonb;
BEGIN
  IF jsonb_typeof(v_rows) <> 'array' OR jsonb_array_length(v_rows) = 0
     OR jsonb_typeof(v_columns) <> 'array' OR jsonb_array_length(v_columns) = 0 THEN
    RAISE EXCEPTION 'rows and columns are required' USING ERRCODE='22023';
  END IF;

  v_campaign_id := NULLIF(p_payload->>'campaignId','')::integer;
  v_warehouse_id := NULLIF(p_payload->>'warehouseId','')::integer;
  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Select an existing approved campaign before importing a manifest'
      USING ERRCODE='22023';
  END IF;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'A source warehouse is required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_campaign
  FROM public.campaigns
  WHERE id=v_campaign_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign % does not exist',v_campaign_id USING ERRCODE='23503';
  END IF;
  IF lower(v_campaign.status) NOT IN ('approved','active') THEN
    RAISE EXCEPTION 'Manifest import requires an Approved or Active campaign';
  END IF;
  IF v_campaign.source_warehouse_id IS NULL
     OR v_campaign.source_warehouse_id<>v_warehouse_id THEN
    RAISE EXCEPTION 'Manifest warehouse must match the campaign source warehouse';
  END IF;
  IF v_campaign.distribution_site_id IS NULL THEN
    RAISE EXCEPTION 'Campaign requires a distribution site before manifest import';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_columns) col
    WHERE nullif(col->>'itemId','') IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.campaign_items ci
         WHERE ci.campaign_id=v_campaign_id
           AND ci.input_item_id=(col->>'itemId')::integer
       )
  ) THEN
    RAISE EXCEPTION 'Every manifest item must be linked to an item configured on the campaign';
  END IF;

  -- Imported beneficiaries must already be approved and allocated. This keeps
  -- approval and allocation changes inside the formal campaign workflow.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_rows) row_data
    WHERE nullif(btrim(row_data->>'community'),'') IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.farmers f
         JOIN public.allocations a
           ON a.farmer_id=f.id
          AND a.campaign_id=v_campaign_id
          AND a.status<>'Cancelled'
         JOIN public.districts d ON d.id=f.district_id
         WHERE f.farmer_group=btrim(row_data->>'community')
           AND lower(f.status)='approved'
           AND f.district_id=v_campaign.district_id
           AND (f.value_chain_id IS NULL OR f.value_chain_id=v_campaign.value_chain_id)
           AND lower(d.name)=lower(btrim(row_data->>'district'))
       )
  ) THEN
    RAISE EXCEPTION 'Every manifest community must be an approved farmer group already allocated to this campaign';
  END IF;

  -- Lock all campaign reservation rows in item order before checking totals.
  PERFORM r.id
  FROM public.campaign_stock_reservations r
  WHERE r.campaign_id=v_campaign_id
  ORDER BY r.input_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign has no active stock reservation';
  END IF;

  WITH required AS (
    SELECT (col.value->>'itemId')::integer AS input_item_id,
           sum(greatest(0,coalesce((row_data.value->'quantities'->>(col.ordinality-1))::double precision,0))) AS quantity
    FROM jsonb_array_elements(v_columns) WITH ORDINALITY col(value,ordinality)
    CROSS JOIN jsonb_array_elements(v_rows) row_data(value)
    GROUP BY (col.value->>'itemId')::integer
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'itemName',i.name,
           'needed',required.quantity,
           'reserved',coalesce(r.reserved_quantity,0)
         )),'[]'::jsonb)
    INTO v_reservation_shortfalls
    FROM required
    JOIN public.input_items i ON i.id=required.input_item_id
    LEFT JOIN public.campaign_stock_reservations r
      ON r.campaign_id=v_campaign_id AND r.input_item_id=required.input_item_id
   WHERE r.id IS NULL OR required.quantity>r.reserved_quantity;
  IF jsonb_array_length(v_reservation_shortfalls)>0 THEN
    RAISE EXCEPTION 'campaign_reservation_exceeded: %',v_reservation_shortfalls
      USING ERRCODE='P0001';
  END IF;

  WITH required AS (
    SELECT (col.value->>'itemId')::integer AS input_item_id,
           sum(greatest(0,coalesce((row_data.value->'quantities'->>(col.ordinality-1))::double precision,0))) AS quantity
    FROM jsonb_array_elements(v_columns) WITH ORDINALITY col(value,ordinality)
    CROSS JOIN jsonb_array_elements(v_rows) row_data(value)
    GROUP BY (col.value->>'itemId')::integer
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'itemName',i.name,
           'needed',required.quantity,
           'available',coalesce(sb.available,0)
         )),'[]'::jsonb)
    INTO v_shortfalls
    FROM required
    JOIN public.input_items i ON i.id=required.input_item_id
    LEFT JOIN public.stock_balance sb
      ON sb.warehouse_id=v_warehouse_id AND sb.input_item_id=required.input_item_id
   WHERE required.quantity>coalesce(sb.available,0);
  IF jsonb_array_length(v_shortfalls)>0 THEN
    RAISE EXCEPTION 'insufficient_stock: %',v_shortfalls USING ERRCODE='P0001';
  END IF;

  WITH required AS (
    SELECT (col.value->>'itemId')::integer AS input_item_id,
           sum(greatest(0,coalesce((row_data.value->'quantities'->>(col.ordinality-1))::double precision,0))) AS quantity
    FROM jsonb_array_elements(v_columns) WITH ORDINALITY col(value,ordinality)
    CROSS JOIN jsonb_array_elements(v_rows) row_data(value)
    GROUP BY (col.value->>'itemId')::integer
  )
  SELECT coalesce(sum(quantity),0) INTO v_total FROM required;
  IF v_total<=0 THEN
    RAISE EXCEPTION 'Manifest requires positive item quantities' USING ERRCODE='22023';
  END IF;

  v_manifest_code := 'MAN-'||upper(substr(md5(clock_timestamp()::text||random()::text),1,12));
  INSERT INTO public.dispatches(
    manifest_code,campaign_id,warehouse_id,vehicle_type,vehicle_id,driver_id,
    hired_plate,hired_driver_name,field_officer_id,notes,created_by,total_packages
  ) VALUES (
    v_manifest_code,v_campaign_id,v_warehouse_id,coalesce(p_payload->>'vehicleType','office'),
    CASE WHEN p_payload->>'vehicleType'='hired' THEN NULL ELSE nullif(p_payload->>'vehicleId','')::integer END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN NULL ELSE nullif(p_payload->>'driverId','')::integer END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN upper(p_payload->>'hiredPlate') END,
    CASE WHEN p_payload->>'vehicleType'='hired' THEN p_payload->>'hiredDriverName' END,
    nullif(p_payload->>'fieldOfficerId','')::integer,p_payload->>'notes',p_created_by,round(v_total)::integer
  ) RETURNING id,to_jsonb(dispatches) INTO v_dispatch_id,v_dispatch;

  INSERT INTO public.dispatch_items(dispatch_id,input_item_id,quantity_loaded)
  SELECT v_dispatch_id,(col.value->>'itemId')::integer,
         sum(greatest(0,coalesce((row_data.value->'quantities'->>(col.ordinality-1))::double precision,0)))
  FROM jsonb_array_elements(v_columns) WITH ORDINALITY col(value,ordinality)
  CROSS JOIN jsonb_array_elements(v_rows) row_data(value)
  GROUP BY (col.value->>'itemId')::integer
  HAVING sum(greatest(0,coalesce((row_data.value->'quantities'->>(col.ordinality-1))::double precision,0)))>0;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'community',f.farmer_group,
           'district',d.name,
           'farmerCode',f.farmer_code,
           'barcodeToken',f.barcode_token
         )),'[]'::jsonb)
    INTO v_communities
    FROM jsonb_array_elements(v_rows) row_data
    JOIN public.farmers f ON f.farmer_group=btrim(row_data->>'community')
    JOIN public.districts d ON d.id=f.district_id
   WHERE f.district_id=v_campaign.district_id;

  RETURN jsonb_build_object(
    'dispatch',v_dispatch,
    'manifestCode',v_manifest_code,
    'campaignId',v_campaign_id,
    'campaignName',v_campaign.name,
    'itemsCreated',0,
    'farmersCreated',0,
    'totalCommunities',jsonb_array_length(v_rows),
    'communities',v_communities
  );
END $$;

-- The old RPC can auto-create an approved campaign and is no longer an API.
REVOKE ALL ON FUNCTION public.import_manifest_atomic(jsonb,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_campaign_manifest_atomic(jsonb,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_campaign_manifest_atomic(jsonb,integer)
  TO service_role;

COMMIT;
