-- Regression tests for 20260907000000_allocation_entitlements.
-- Each block raises on failure, so a non-zero psql exit means a broken invariant.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

-- ── Entitlement arithmetic ───────────────────────────────────────────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT public.transition_campaign_atomic(901, 'Submitted');

SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=901 AND input_item_id=901) = 1,
  'per_beneficiary gives a group one tiller regardless of size');
SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=901 AND input_item_id=902) = 20,
  'per_member gives a 20-member group 20 hoes');
SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=901 AND input_item_id=903) = 8,
  'per_hectare gives a 4ha group 8 bags at 2/ha');
SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=902 AND input_item_id=902) = 1,
  'per_member treats an individual as one member');

SELECT public.transition_campaign_atomic(901, 'Approved');
SELECT pg_temp.expect(
  (SELECT reserved_quantity FROM campaign_stock_reservations WHERE campaign_id=901 AND input_item_id=902) = 21,
  'reservation sums entitlements (21 hoes) rather than rate x headcount (2)');
ROLLBACK;

-- ── A basis whose input is missing must block, not silently allocate zero ────
BEGIN;
\i supabase/tests/10_fixtures.sql
UPDATE farmers SET group_size = NULL WHERE id = 901;
DO $$ BEGIN
  PERFORM public.transition_campaign_atomic(901, 'Submitted');
  RAISE EXCEPTION 'FAILED: a group with no size was allowed through';
EXCEPTION WHEN sqlstate '22023' THEN
  RAISE NOTICE '  ok  a group with no recorded size blocks submission';
END $$;
ROLLBACK;

-- ── Manual overrides survive re-materialisation ──────────────────────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT public.transition_campaign_atomic(901, 'Submitted');
UPDATE allocation_items SET quantity_entitled = 15, is_overridden = true
 WHERE allocation_id = 901 AND input_item_id = 902;
UPDATE campaign_items SET quantity_per_farmer = 3 WHERE campaign_id = 901 AND input_item_id = 903;
SELECT public.materialize_allocation_items(901);
SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=901 AND input_item_id=902) = 15,
  'an overridden line keeps its manual quantity');
SELECT pg_temp.expect(
  (SELECT quantity_entitled FROM allocation_items WHERE allocation_id=901 AND input_item_id=903) = 12,
  'a non-overridden line re-derives from the edited rate');
ROLLBACK;

-- ── Cancelled allocations drop out ───────────────────────────────────────────
BEGIN;
\i supabase/tests/10_fixtures.sql
SELECT public.transition_campaign_atomic(901, 'Submitted');
UPDATE allocations SET status = 'Cancelled' WHERE id = 902;
SELECT public.materialize_allocation_items(901);
SELECT pg_temp.expect(
  (SELECT count(*) FROM allocation_items WHERE allocation_id = 902) = 0,
  'a cancelled allocation loses its entitlement lines');
ROLLBACK;
