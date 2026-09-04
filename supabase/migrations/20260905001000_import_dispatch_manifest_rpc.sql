-- Final manifest writes must be all-or-nothing.  The API prepares its lookup
-- data first, then delegates allocations, officer assignment, the dispatch,
-- its item rows and total to this single transaction.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS hired_plate text,
  ADD COLUMN IF NOT EXISTS hired_driver_name text,
  ADD COLUMN IF NOT EXISTS field_officer_id integer REFERENCES public.users(id);

CREATE OR REPLACE FUNCTION public.import_dispatch_manifest(
  p_manifest_code text,
  p_campaign_id integer,
  p_warehouse_id integer,
  p_vehicle_type text,
  p_vehicle_id integer,
  p_driver_id integer,
  p_hired_plate text,
  p_hired_driver_name text,
  p_field_officer_id integer,
  p_notes text,
  p_created_by integer,
  p_farmer_ids jsonb,
  p_dispatch_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch dispatches%ROWTYPE;
  v_farmer_id integer;
  v_item record;
  v_total double precision := 0;
  v_farmer_count integer;
  v_item_count integer;
BEGIN
  IF p_manifest_code IS NULL OR btrim(p_manifest_code) = '' THEN
    RAISE EXCEPTION 'manifest code is required' USING ERRCODE = '22023';
  END IF;
  IF p_campaign_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'campaign and warehouse are required' USING ERRCODE = '22023';
  END IF;
  IF p_vehicle_type NOT IN ('office', 'hired') THEN
    RAISE EXCEPTION 'invalid vehicle type' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_farmer_ids) <> 'array' OR jsonb_typeof(p_dispatch_items) <> 'array' THEN
    RAISE EXCEPTION 'farmer IDs and dispatch items must be arrays' USING ERRCODE = '22023';
  END IF;

  -- Locking the campaign serializes allocation creation for a campaign and
  -- makes the NOT EXISTS insert safe even on concurrent imports.
  PERFORM 1 FROM campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign % does not exist', p_campaign_id USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM warehouses WHERE id = p_warehouse_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse % does not exist', p_warehouse_id USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM dispatches WHERE manifest_code = p_manifest_code) THEN
    RAISE EXCEPTION 'manifest code already exists' USING ERRCODE = '23505';
  END IF;
  IF p_field_officer_id IS NOT NULL THEN
    PERFORM 1 FROM users WHERE id = p_field_officer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'field officer % does not exist', p_field_officer_id USING ERRCODE = '23503'; END IF;
  END IF;
  IF p_vehicle_type = 'office' THEN
    IF p_vehicle_id IS NOT NULL THEN
      PERFORM 1 FROM vehicles WHERE id = p_vehicle_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'vehicle % does not exist', p_vehicle_id USING ERRCODE = '23503'; END IF;
    END IF;
    IF p_driver_id IS NOT NULL THEN
      PERFORM 1 FROM drivers WHERE id = p_driver_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'driver % does not exist', p_driver_id USING ERRCODE = '23503'; END IF;
    END IF;
  ELSIF p_hired_plate IS NULL OR btrim(p_hired_plate) = '' OR p_hired_driver_name IS NULL OR btrim(p_hired_driver_name) = '' THEN
    RAISE EXCEPTION 'hired dispatch requires a plate and driver name' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_farmer_count FROM jsonb_array_elements_text(p_farmer_ids);
  SELECT count(*) INTO v_item_count
  FROM jsonb_to_recordset(p_dispatch_items) AS x(input_item_id integer, quantity_loaded double precision);
  IF v_farmer_count = 0 OR v_item_count = 0 THEN
    RAISE EXCEPTION 'a manifest requires beneficiaries and at least one item' USING ERRCODE = '22023';
  END IF;

  -- Validate each reference and total, including duplicate item columns.
  FOR v_item IN
    SELECT input_item_id, sum(quantity_loaded) AS quantity_loaded
    FROM jsonb_to_recordset(p_dispatch_items) AS x(input_item_id integer, quantity_loaded double precision)
    GROUP BY input_item_id
  LOOP
    IF v_item.input_item_id IS NULL OR v_item.quantity_loaded IS NULL
       OR v_item.quantity_loaded <= 0
       OR v_item.quantity_loaded IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8) THEN
      RAISE EXCEPTION 'dispatch items require positive finite quantities' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM input_items WHERE id = v_item.input_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'input item % does not exist', v_item.input_item_id USING ERRCODE = '23503'; END IF;
    v_total := v_total + v_item.quantity_loaded;
  END LOOP;

  FOR v_farmer_id IN SELECT DISTINCT value::integer FROM jsonb_array_elements_text(p_farmer_ids)
  LOOP
    PERFORM 1 FROM farmers WHERE id = v_farmer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'farmer % does not exist', v_farmer_id USING ERRCODE = '23503'; END IF;
    INSERT INTO allocations (campaign_id, farmer_id, notes, allocated_by)
    SELECT p_campaign_id, v_farmer_id, 'Imported from Excel manifest', p_created_by
    WHERE NOT EXISTS (
      SELECT 1 FROM allocations WHERE campaign_id = p_campaign_id AND farmer_id = v_farmer_id
    );
  END LOOP;

  INSERT INTO dispatches (
    manifest_code, campaign_id, warehouse_id, vehicle_type, vehicle_id, driver_id,
    hired_plate, hired_driver_name, field_officer_id, notes, created_by, total_packages
  ) VALUES (
    p_manifest_code, p_campaign_id, p_warehouse_id, p_vehicle_type,
    CASE WHEN p_vehicle_type = 'office' THEN p_vehicle_id ELSE NULL END,
    CASE WHEN p_vehicle_type = 'office' THEN p_driver_id ELSE NULL END,
    CASE WHEN p_vehicle_type = 'hired' THEN p_hired_plate ELSE NULL END,
    CASE WHEN p_vehicle_type = 'hired' THEN p_hired_driver_name ELSE NULL END,
    p_field_officer_id, p_notes, p_created_by, round(v_total)::integer
  )
  RETURNING * INTO v_dispatch;

  INSERT INTO dispatch_items (dispatch_id, input_item_id, quantity_loaded)
  SELECT v_dispatch.id, x.input_item_id, sum(x.quantity_loaded)
  FROM jsonb_to_recordset(p_dispatch_items) AS x(input_item_id integer, quantity_loaded double precision)
  GROUP BY x.input_item_id;

  RETURN to_jsonb(v_dispatch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_dispatch_manifest(
  text, integer, integer, text, integer, integer, text, text, integer, text, integer, jsonb, jsonb
) TO service_role;