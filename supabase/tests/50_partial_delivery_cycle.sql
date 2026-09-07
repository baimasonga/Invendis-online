-- The full split-delivery cycle through the RPCs the API actually calls:
-- submit_pod_atomic then approve_pods_atomic, twice.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ready_dispatch() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.transition_campaign_atomic(901, 'Submitted');
  PERFORM public.transition_campaign_atomic(901, 'Approved');
  INSERT INTO dispatches(id, campaign_id, vehicle_id, driver_id, warehouse_id, field_officer_id, status)
    VALUES (901, 901, 901, 901, 901, 903, 'In Transit');
  INSERT INTO dispatch_items(dispatch_id, input_item_id, quantity_loaded)
    VALUES (901, 901, 2), (901, 902, 21), (901, 903, 12);
  UPDATE stock_balance SET loaded = q.qty
    FROM (VALUES (901, 2.0), (902, 21.0), (903, 12.0)) AS q(item, qty)
   WHERE warehouse_id = 901 AND input_item_id = q.item;
END $$;

-- Submits through the real RPC, mirroring what the API sends.
CREATE OR REPLACE FUNCTION pg_temp.submit(p_key text, p_items jsonb) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := public.submit_pod_atomic(
    jsonb_build_object(
      'dispatch_id', 901, 'campaign_id', 901, 'farmer_id', 901,
      'field_officer_id', 903, 'status', 'Pending', 'submission_key', p_key),
    p_items);
  RETURN (v->>'id')::integer;
END $$;

BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();

-- First trip: the tiller and the hoes, but only three of eight bags.
SELECT pg_temp.submit('key-first', '[{"input_item_id":901,"quantity_delivered":1},
                                     {"input_item_id":902,"quantity_delivered":20},
                                     {"input_item_id":903,"quantity_delivered":3}]'::jsonb) AS first_pod \gset
SELECT pg_temp.expect(
  (SELECT COALESCE(duplicate_flag, false) FROM pod WHERE id = :first_pod) = false,
  'the first delivery is not flagged as a duplicate');
SELECT public.approve_pods_atomic(jsonb_build_array(:first_pod), 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Partially Delivered',
  'after the first approval the allocation is Partially Delivered');

-- Re-sending the same submission key must not create a second delivery.
SELECT pg_temp.submit('key-first', '[{"input_item_id":903,"quantity_delivered":5}]'::jsonb) AS replay \gset
SELECT pg_temp.expect(
  :replay = :first_pod,
  'a replayed submission key returns the original delivery');

-- Second trip: the outstanding five bags. The database must accept this even
-- though a Verified delivery already exists for the same beneficiary.
SELECT pg_temp.submit('key-second', '[{"input_item_id":903,"quantity_delivered":5}]'::jsonb) AS second_pod \gset
SELECT pg_temp.expect(
  (SELECT COALESCE(duplicate_flag, false) FROM pod WHERE id = :second_pod) = false,
  'the balance delivery is accepted alongside the verified first one');
SELECT public.approve_pods_atomic(jsonb_build_array(:second_pod), 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Delivered',
  'approving the balance closes the allocation');
SELECT pg_temp.expect(
  (SELECT sum(quantity_delivered) FROM allocation_items WHERE allocation_id = 901) = 29,
  'every entitled unit is accounted for (1 + 20 + 8)');
SELECT pg_temp.expect(
  (SELECT delivered_count FROM campaigns WHERE id = 901) = 1,
  'the campaign counts the beneficiary only once fully delivered');

-- A third trip has nothing left to carry.
DO $$ BEGIN
  PERFORM pg_temp.submit('key-third', '[{"input_item_id":903,"quantity_delivered":1}]'::jsonb);
  RAISE EXCEPTION 'FAILED: a delivery was accepted after the package was complete';
EXCEPTION WHEN sqlstate '23505' THEN
  RAISE NOTICE '  ok  a third delivery is refused once nothing is outstanding';
END $$;
ROLLBACK;

-- Without entitlement lines the historical single-delivery rule still holds.
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();
DELETE FROM allocation_items;
SELECT pg_temp.submit('legacy-first', '[{"input_item_id":901,"quantity_delivered":1}]'::jsonb) AS legacy_pod \gset
SELECT public.approve_pods_atomic(jsonb_build_array(:legacy_pod), 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Delivered',
  'a legacy allocation still closes on its first approved delivery');
DO $$ BEGIN
  PERFORM pg_temp.submit('legacy-second', '[{"input_item_id":902,"quantity_delivered":1}]'::jsonb);
  RAISE EXCEPTION 'FAILED: a legacy beneficiary received a second delivery';
EXCEPTION WHEN sqlstate '23505' THEN
  RAISE NOTICE '  ok  a legacy beneficiary is still limited to one delivery';
END $$;
ROLLBACK;
