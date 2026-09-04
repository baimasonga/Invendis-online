-- Approve one or more PoDs as a single serialized accounting operation.
-- Lock order is always PoD id, then dispatch id/item id, preventing duplicate
-- increments and avoiding deadlocks between single and batch approvals.
CREATE OR REPLACE FUNCTION public.approve_pods_atomic(
  p_pod_ids jsonb,
  p_approved_by integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids integer[];
  v_requested_count integer;
  v_pod record;
  v_delivery record;
  v_dispatch_item record;
  v_campaign_id integer;
  v_dispatch_id integer;
  v_dispatch_status text;
BEGIN
  IF jsonb_typeof(p_pod_ids) <> 'array' OR jsonb_array_length(p_pod_ids) = 0 THEN
    RAISE EXCEPTION 'pod IDs must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), array_agg(DISTINCT value::integer ORDER BY value::integer)
  INTO v_requested_count, v_ids
  FROM jsonb_array_elements_text(p_pod_ids);
  IF cardinality(v_ids) <> v_requested_count THEN
    RAISE EXCEPTION 'duplicate pod IDs are not allowed' USING ERRCODE = '22023';
  END IF;

  -- Require every requested row to exist and still be Pending while locked.
  FOR v_pod IN
    SELECT id, status
    FROM pod
    WHERE id = ANY(v_ids)
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_pod.status <> 'Pending' THEN
      RAISE EXCEPTION 'PoD % has already been processed (status: %)', v_pod.id, v_pod.status
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pod WHERE id = ANY(v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'one or more PoDs do not exist' USING ERRCODE = 'P0002';
  END IF;

  -- Follow the lifecycle lock order used by start_dispatch_atomic: linked
  -- dispatch rows first, then dispatch_items, then stock balances. Non-dispatch
  -- PoDs intentionally skip this validation.
  FOR v_dispatch_id, v_dispatch_status IN
    SELECT d.id, d.status
    FROM dispatches d
    WHERE d.id IN (
      SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL
    )
    ORDER BY d.id
    FOR UPDATE
  LOOP
    IF v_dispatch_status NOT IN ('In Transit', 'Arrived') THEN
      RAISE EXCEPTION 'dispatch % cannot approve deliveries from status %',v_dispatch_id,v_dispatch_status
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  -- Serialize accounting for all affected manifest rows in deterministic order.
  PERFORM di.id
  FROM dispatch_items di
  WHERE di.dispatch_id IN (
    SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL
  )
  ORDER BY di.dispatch_id, di.id
  FOR UPDATE;

  -- Aggregate multi-item rows, falling back to the legacy fields only when a
  -- PoD has no pod_items rows.
  FOR v_delivery IN
    SELECT p.dispatch_id, delivered.input_item_id, sum(delivered.quantity_delivered) AS quantity
    FROM pod p
    CROSS JOIN LATERAL (
      SELECT pi.input_item_id, pi.quantity_delivered
      FROM pod_items pi
      WHERE pi.pod_id = p.id
      UNION ALL
      SELECT p.input_item_id, p.quantity_delivered
      WHERE p.input_item_id IS NOT NULL
        AND p.quantity_delivered IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pod_items pi WHERE pi.pod_id = p.id)
    ) delivered
    WHERE p.id = ANY(v_ids) AND p.dispatch_id IS NOT NULL
    GROUP BY p.dispatch_id, delivered.input_item_id
    ORDER BY p.dispatch_id, delivered.input_item_id
  LOOP
    IF v_delivery.input_item_id IS NULL OR v_delivery.quantity IS NULL
       OR v_delivery.quantity <= 0
       OR v_delivery.quantity IN ('Infinity'::float8, '-Infinity'::float8, 'NaN'::float8) THEN
      RAISE EXCEPTION 'PoD delivery quantities must be positive and finite' USING ERRCODE = '22023';
    END IF;

    SELECT id, quantity_loaded, COALESCE(quantity_delivered, 0) AS quantity_delivered
    INTO v_dispatch_item
    FROM dispatch_items
    WHERE dispatch_id = v_delivery.dispatch_id
      AND input_item_id = v_delivery.input_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item % is not on dispatch %', v_delivery.input_item_id, v_delivery.dispatch_id
        USING ERRCODE = '23503';
    END IF;
    IF v_dispatch_item.quantity_delivered + v_delivery.quantity > v_dispatch_item.quantity_loaded THEN
      RAISE EXCEPTION 'approval quantity for item % exceeds loaded quantity on dispatch %',
        v_delivery.input_item_id, v_delivery.dispatch_id USING ERRCODE = '22023';
    END IF;

    UPDATE dispatch_items
    SET quantity_delivered = v_dispatch_item.quantity_delivered + v_delivery.quantity
    WHERE id = v_dispatch_item.id;

    -- Keep warehouse movement counters in the same approval transaction.
    UPDATE stock_balance sb
    SET loaded = GREATEST(0, COALESCE(sb.loaded, 0) - v_delivery.quantity),
        delivered = COALESCE(sb.delivered, 0) + v_delivery.quantity,
        updated_at = now()
    FROM dispatches d
    WHERE d.id = v_delivery.dispatch_id
      AND sb.warehouse_id = d.warehouse_id
      AND sb.input_item_id = v_delivery.input_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stock balance is missing for item % on dispatch %',
        v_delivery.input_item_id, v_delivery.dispatch_id USING ERRCODE = '23503';
    END IF;
  END LOOP;

  UPDATE pod
  SET status = 'Verified', approved_by = p_approved_by, approved_at = now()
  WHERE id = ANY(v_ids);

  UPDATE allocations a
  SET status = 'Delivered', updated_at = now()
  FROM (
    SELECT DISTINCT farmer_id, campaign_id
    FROM pod
    WHERE id = ANY(v_ids)
  ) approved
  WHERE a.farmer_id = approved.farmer_id
    AND a.campaign_id = approved.campaign_id
    AND a.status <> 'Delivered';

  FOR v_campaign_id IN
    SELECT DISTINCT campaign_id FROM pod WHERE id = ANY(v_ids) AND campaign_id IS NOT NULL ORDER BY campaign_id
  LOOP
    UPDATE campaigns
    SET delivered_count = (
      SELECT count(*) FROM allocations
      WHERE campaign_id = v_campaign_id AND status = 'Delivered'
    )
    WHERE id = v_campaign_id;
  END LOOP;

  FOR v_dispatch_id IN
    SELECT DISTINCT dispatch_id FROM pod WHERE id = ANY(v_ids) AND dispatch_id IS NOT NULL ORDER BY dispatch_id
  LOOP
    UPDATE dispatches
    SET delivered_packages = round((
      SELECT COALESCE(sum(quantity_delivered), 0)
      FROM dispatch_items
      WHERE dispatch_id = v_dispatch_id
    ))::integer,
    updated_at = now()
    WHERE id = v_dispatch_id;
  END LOOP;

  RETURN cardinality(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pods_atomic(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_pods_atomic(jsonb, integer) TO service_role;