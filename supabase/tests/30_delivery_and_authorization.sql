-- Delivery accounting, partial fulfilment, over-delivery and approver checks.
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

-- ── A short delivery leaves the allocation open, the balance closes it ───────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();

INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (901, 901, 901, 901, 'Pending');
INSERT INTO pod_items(pod_id, input_item_id, quantity_delivered) VALUES (901, 901, 1), (901, 902, 20), (901, 903, 3);
SELECT public.approve_pods_atomic('[901]'::jsonb, 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Partially Delivered',
  'a short delivery leaves the allocation Partially Delivered');
SELECT pg_temp.expect(
  (SELECT delivered_count FROM campaigns WHERE id = 901) = 0,
  'a partially delivered beneficiary is not counted as delivered');

INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (902, 901, 901, 901, 'Pending');
INSERT INTO pod_items(pod_id, input_item_id, quantity_delivered) VALUES (902, 903, 5);
SELECT public.approve_pods_atomic('[902]'::jsonb, 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Delivered',
  'the balance delivery closes the allocation');
ROLLBACK;

-- ── Over-delivery is refused ─────────────────────────────────────────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();
INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (901, 901, 901, 901, 'Pending');
-- 21 hoes were loaded for both beneficiaries; this group is owed only 20.
INSERT INTO pod_items(pod_id, input_item_id, quantity_delivered) VALUES (901, 902, 21);
DO $$ BEGIN
  PERFORM public.approve_pods_atomic('[901]'::jsonb, 901);
  RAISE EXCEPTION 'FAILED: a delivery beyond the entitlement was approved';
EXCEPTION WHEN sqlstate '22023' THEN
  RAISE NOTICE '  ok  a delivery beyond the beneficiary entitlement is refused';
END $$;
ROLLBACK;

-- ── A further delivery once the package is complete is refused ──────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();
INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (901, 901, 901, 901, 'Pending');
INSERT INTO pod_items(pod_id, input_item_id, quantity_delivered) VALUES (901, 901, 1), (901, 902, 20), (901, 903, 8);
SELECT public.approve_pods_atomic('[901]'::jsonb, 901);
SELECT pg_temp.expect(
  (SELECT status FROM allocations WHERE id = 901) = 'Delivered',
  'a complete delivery closes the allocation in one go');
DO $$ BEGIN
  INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (903, 901, 901, 901, 'Pending');
  RAISE EXCEPTION 'FAILED: a delivery was accepted after the package was complete';
EXCEPTION WHEN sqlstate '23505' THEN
  RAISE NOTICE '  ok  a further delivery is refused once the package is complete';
END $$;
ROLLBACK;

-- ── Only one delivery may be open at a time ─────────────────────────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();
INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (901, 901, 901, 901, 'Pending');
DO $$ BEGIN
  INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (902, 901, 901, 901, 'Pending');
  RAISE EXCEPTION 'FAILED: two open deliveries were allowed for one beneficiary';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE '  ok  a second open delivery for the same beneficiary is refused';
END $$;
ROLLBACK;

-- ── The approver checks from 20260905004200 must survive this migration ─────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT pg_temp.ready_dispatch();
INSERT INTO pod(id, farmer_id, campaign_id, dispatch_id, status) VALUES (901, 901, 901, 901, 'Pending');
INSERT INTO pod_items(pod_id, input_item_id, quantity_delivered) VALUES (901, 901, 1);
DO $$ BEGIN
  PERFORM public.approve_pods_atomic('[901]'::jsonb, 902);
  RAISE EXCEPTION 'FAILED: an inactive user approved a delivery';
EXCEPTION WHEN sqlstate '23503' THEN
  RAISE NOTICE '  ok  an inactive approver is refused';
END $$;
DO $$ BEGIN
  PERFORM public.approve_pods_atomic('[901]'::jsonb, 903);
  RAISE EXCEPTION 'FAILED: a field officer approved a delivery';
EXCEPTION WHEN sqlstate '23503' THEN
  RAISE NOTICE '  ok  an approver without an operational role is refused';
END $$;
UPDATE pod SET duplicate_flag = true WHERE id = 901;
DO $$ BEGIN
  PERFORM public.approve_pods_atomic('[901]'::jsonb, 901);
  RAISE EXCEPTION 'FAILED: a duplicate-flagged PoD was approved';
EXCEPTION WHEN sqlstate '55000' THEN
  RAISE NOTICE '  ok  a duplicate-flagged PoD is refused';
END $$;
ROLLBACK;
