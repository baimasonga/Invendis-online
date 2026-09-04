-- Arrival and cancellation change the manifest, vehicle, and (when loaded)
-- inventory together.  Keep the lifecycle lock order: dispatch, items,
-- stock balances (by item), then vehicle.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE OR REPLACE FUNCTION public.arrive_dispatch_atomic(
  p_dispatch_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch dispatches%ROWTYPE;
  v_vehicle_id integer;
BEGIN
  SELECT * INTO v_dispatch
  FROM dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispatch % does not exist', p_dispatch_id USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.status <> 'In Transit' THEN
    RAISE EXCEPTION 'dispatch % cannot arrive from status %', p_dispatch_id, v_dispatch.status
      USING ERRCODE = '55000';
  END IF;

  IF v_dispatch.vehicle_id IS NOT NULL THEN
    SELECT id INTO v_vehicle_id FROM vehicles WHERE id = v_dispatch.vehicle_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vehicle % does not exist', v_dispatch.vehicle_id USING ERRCODE = '23503';
    END IF;
  END IF;

  UPDATE dispatches
  SET status = 'Arrived', arrived_at = now(), updated_at = now()
  WHERE id = p_dispatch_id
  RETURNING * INTO v_dispatch;

  IF v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles SET status = 'Active' WHERE id = v_vehicle_id;
  END IF;

  RETURN to_jsonb(v_dispatch);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_dispatch_atomic(
  p_dispatch_id integer,
  p_reason text,
  p_cancelled_by integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch dispatches%ROWTYPE;
  v_item record;
  v_return record;
  v_balance record;
  v_vehicle_id integer;
BEGIN
  SELECT * INTO v_dispatch
  FROM dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispatch % does not exist', p_dispatch_id USING ERRCODE = 'P0002';
  END IF;
  IF v_dispatch.status NOT IN ('Draft', 'Approved', 'In Transit') THEN
    RAISE EXCEPTION 'dispatch % cannot cancel from status %', p_dispatch_id, v_dispatch.status
      USING ERRCODE = '55000';
  END IF;

  -- Lock manifest lines before balances, matching other stock lifecycle RPCs.
  PERFORM di.id
  FROM dispatch_items di
  WHERE di.dispatch_id = p_dispatch_id
  ORDER BY di.input_item_id, di.id
  FOR UPDATE;

  IF v_dispatch.status = 'In Transit' THEN
    IF v_dispatch.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'dispatch % has no warehouse', p_dispatch_id USING ERRCODE = '22023';
    END IF;

    -- Lock all balances in the same item order used when a dispatch starts.
    PERFORM sb.id
    FROM stock_balance sb
    WHERE sb.warehouse_id = v_dispatch.warehouse_id
      AND sb.input_item_id IN (
        SELECT input_item_id FROM dispatch_items WHERE dispatch_id = p_dispatch_id
      )
    ORDER BY sb.input_item_id, sb.id
    FOR UPDATE;

    FOR v_item IN
      SELECT id, input_item_id, quantity_loaded,
             COALESCE(quantity_delivered, 0) AS quantity_delivered,
             COALESCE(quantity_returned, 0) AS quantity_returned
      FROM dispatch_items
      WHERE dispatch_id = p_dispatch_id
      ORDER BY input_item_id, id
    LOOP
      IF v_item.input_item_id IS NULL
         OR v_item.quantity_loaded IS NULL
         OR v_item.quantity_loaded < 0
         OR v_item.quantity_delivered < 0
         OR v_item.quantity_returned < 0
         OR v_item.quantity_loaded IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
         OR v_item.quantity_delivered IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
         OR v_item.quantity_returned IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8)
         OR v_item.quantity_delivered + v_item.quantity_returned > v_item.quantity_loaded THEN
        RAISE EXCEPTION 'dispatch item % has unsafe loaded, delivered, or returned quantities', v_item.id
          USING ERRCODE = '22023';
      END IF;
    END LOOP;

    FOR v_return IN
      SELECT input_item_id,
             sum(quantity_loaded - COALESCE(quantity_delivered, 0) - COALESCE(quantity_returned, 0)) AS quantity
      FROM dispatch_items
      WHERE dispatch_id = p_dispatch_id
      GROUP BY input_item_id
      ORDER BY input_item_id
    LOOP
      IF v_return.quantity > 0 THEN
        SELECT id, loaded INTO v_balance
        FROM stock_balance
        WHERE warehouse_id = v_dispatch.warehouse_id
          AND input_item_id = v_return.input_item_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'stock balance is missing for item % at warehouse %',
            v_return.input_item_id, v_dispatch.warehouse_id USING ERRCODE = '23503';
        END IF;
        IF COALESCE(v_balance.loaded, 0) < v_return.quantity THEN
          RAISE EXCEPTION 'loaded stock is insufficient to cancel item %: required %, loaded %',
            v_return.input_item_id, v_return.quantity, COALESCE(v_balance.loaded, 0)
            USING ERRCODE = '22023';
        END IF;

        UPDATE stock_balance
        SET available = COALESCE(available, 0) + v_return.quantity,
            loaded = COALESCE(loaded, 0) - v_return.quantity,
            returned = COALESCE(returned, 0) + v_return.quantity,
            updated_at = now()
        WHERE id = v_balance.id;

        INSERT INTO stock_ledger(
          warehouse_id, input_item_id, txn_type, quantity, reference, notes, created_by
        ) VALUES (
          v_dispatch.warehouse_id, v_return.input_item_id, 'RETURN',
          v_return.quantity, v_dispatch.manifest_code,
          'Returned after cancellation of manifest ' || COALESCE(v_dispatch.manifest_code, p_dispatch_id::text),
          p_cancelled_by
        );
      END IF;
    END LOOP;

    UPDATE dispatch_items
    SET quantity_returned = COALESCE(quantity_returned, 0)
      + quantity_loaded - COALESCE(quantity_delivered, 0) - COALESCE(quantity_returned, 0)
    WHERE dispatch_id = p_dispatch_id
      AND quantity_loaded - COALESCE(quantity_delivered, 0) - COALESCE(quantity_returned, 0) > 0;

    IF v_dispatch.vehicle_id IS NOT NULL THEN
      SELECT id INTO v_vehicle_id FROM vehicles WHERE id = v_dispatch.vehicle_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'vehicle % does not exist', v_dispatch.vehicle_id USING ERRCODE = '23503';
      END IF;
    END IF;
  END IF;

  UPDATE dispatches
  SET status = 'Cancelled',
      cancel_reason = p_reason,
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_dispatch_id
  RETURNING * INTO v_dispatch;

  IF v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles SET status = 'Active' WHERE id = v_vehicle_id;
  END IF;

  RETURN to_jsonb(v_dispatch);
END;
$$;

REVOKE ALL ON FUNCTION public.arrive_dispatch_atomic(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arrive_dispatch_atomic(integer) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_dispatch_atomic(integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_dispatch_atomic(integer, text, integer) TO service_role;