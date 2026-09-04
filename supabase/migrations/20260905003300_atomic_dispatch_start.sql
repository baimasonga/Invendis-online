-- Starting a dispatch and moving its stock must be one serialized operation.
CREATE OR REPLACE FUNCTION public.start_dispatch_atomic(
  p_dispatch_id integer,
  p_created_by integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch dispatches%ROWTYPE;
  v_item record;
  v_balance record;
  v_item_count integer;
BEGIN
  SELECT * INTO v_dispatch
  FROM dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispatch % does not exist', p_dispatch_id USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.status <> 'Approved' THEN
    RAISE EXCEPTION 'dispatch % cannot start from status %', p_dispatch_id, v_dispatch.status
      USING ERRCODE = '55000';
  END IF;
  IF v_dispatch.warehouse_id IS NULL THEN
    RAISE EXCEPTION 'dispatch % has no warehouse', p_dispatch_id USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM (
    SELECT input_item_id
    FROM dispatch_items
    WHERE dispatch_id = p_dispatch_id
    GROUP BY input_item_id
  ) items;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'dispatch % has no items', p_dispatch_id USING ERRCODE = '22023';
  END IF;

  -- Lock every affected balance in item order so concurrent dispatch starts
  -- cannot both consume the same available quantity.
  PERFORM sb.id
  FROM stock_balance sb
  WHERE sb.warehouse_id = v_dispatch.warehouse_id
    AND sb.input_item_id IN (
      SELECT input_item_id FROM dispatch_items WHERE dispatch_id = p_dispatch_id
    )
  ORDER BY sb.input_item_id, sb.id
  FOR UPDATE;

  FOR v_item IN
    SELECT input_item_id, sum(quantity_loaded) AS quantity_loaded
    FROM dispatch_items
    WHERE dispatch_id = p_dispatch_id
    GROUP BY input_item_id
    ORDER BY input_item_id
  LOOP
    IF v_item.input_item_id IS NULL OR v_item.quantity_loaded IS NULL
       OR v_item.quantity_loaded <= 0
       OR v_item.quantity_loaded IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8) THEN
      RAISE EXCEPTION 'dispatch items require positive finite loaded quantities'
        USING ERRCODE = '22023';
    END IF;

    SELECT id, available, loaded INTO v_balance
    FROM stock_balance
    WHERE warehouse_id = v_dispatch.warehouse_id
      AND input_item_id = v_item.input_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock balance is missing for item % at warehouse %',
        v_item.input_item_id, v_dispatch.warehouse_id USING ERRCODE = '23503';
    END IF;
    IF COALESCE(v_balance.available, 0) < v_item.quantity_loaded THEN
      RAISE EXCEPTION 'insufficient stock for item %: required %, available %',
        v_item.input_item_id, v_item.quantity_loaded, COALESCE(v_balance.available, 0)
        USING ERRCODE = '22023';
    END IF;

    UPDATE stock_balance
    SET available = COALESCE(v_balance.available, 0) - v_item.quantity_loaded,
        loaded = COALESCE(v_balance.loaded, 0) + v_item.quantity_loaded,
        updated_at = now()
    WHERE id = v_balance.id;

    INSERT INTO stock_ledger(
      warehouse_id, input_item_id, txn_type, quantity, reference, notes, created_by
    ) VALUES (
      v_dispatch.warehouse_id, v_item.input_item_id, 'DISPATCH',
      -v_item.quantity_loaded, v_dispatch.manifest_code,
      'Dispatched on manifest ' || COALESCE(v_dispatch.manifest_code, p_dispatch_id::text),
      p_created_by
    );
  END LOOP;

  UPDATE dispatches
  SET status = 'In Transit', departed_at = now(), updated_at = now()
  WHERE id = p_dispatch_id
  RETURNING * INTO v_dispatch;

  IF v_dispatch.vehicle_id IS NOT NULL THEN
    UPDATE vehicles SET status = 'InTransit' WHERE id = v_dispatch.vehicle_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicle % does not exist', v_dispatch.vehicle_id USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN to_jsonb(v_dispatch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_dispatch_atomic(integer, integer) TO service_role;