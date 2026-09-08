-- Actor columns hold the integer users.id. Writing a profiles uuid is what made
-- campaign creation fail with "invalid input syntax for type integer".
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect(p_ok boolean, p_what text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAILED: %', p_what; END IF;
  RAISE NOTICE '  ok  %', p_what;
END $$;

BEGIN;
\i supabase/tests/10_fixtures.sql

SELECT pg_temp.expect(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='campaigns' AND column_name='created_by') = 'integer',
  'campaigns.created_by is an integer user id');
SELECT pg_temp.expect(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='campaigns' AND column_name='approved_by') = 'integer',
  'campaigns.approved_by is an integer user id');
SELECT pg_temp.expect(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='allocations' AND column_name='allocated_by') = 'integer',
  'allocations.allocated_by is an integer user id');

-- Creating a campaign the way the API does it now.
INSERT INTO campaigns(id, campaign_code, name, season, district_id, value_chain_id,
                      distribution_site_id, source_warehouse_id, start_date, end_date,
                      status, created_by)
VALUES (902, 'CAM-T902', 'Actor Test', '2026 Test', 901, 901, 901, 901,
        now(), now() + interval '30 days', 'Draft', 901);
SELECT pg_temp.expect(
  (SELECT created_by FROM campaigns WHERE id = 902) = 901,
  'a campaign records the integer id of whoever created it');

-- The failure the user hit, reproduced: the old code sent a profiles uuid.
DO $$ BEGIN
  EXECUTE format(
    'INSERT INTO campaigns(id, campaign_code, name, season, district_id, value_chain_id,
       distribution_site_id, source_warehouse_id, start_date, end_date, status, created_by)
     VALUES (903, %L, %L, %L, 901, 901, 901, 901, now(), now() + interval ''30 days'', ''Draft'', %L)',
    'CAM-T903', 'Uuid Actor', '2026 Test', '937d43ae-0f37-4f6d-a53f-9dc957fadad0');
  RAISE EXCEPTION 'FAILED: a profiles uuid was accepted as an actor id';
EXCEPTION WHEN invalid_text_representation THEN
  RAISE NOTICE '  ok  a profiles uuid is still rejected, so the integer id is load-bearing';
END $$;

-- Approval takes the same integer actor through the RPC.
INSERT INTO campaign_items(campaign_id, input_item_id, quantity_per_farmer, basis, unit)
VALUES (902, 901, 1, 'per_beneficiary', 'unit');
INSERT INTO allocations(id, campaign_id, farmer_id, status, allocated_by)
VALUES (903, 902, 901, 'Pending', 901);
SELECT pg_temp.expect(
  (SELECT allocated_by FROM allocations WHERE id = 903) = 901,
  'an allocation records the integer id of whoever made it');

SELECT public.transition_campaign_atomic(902, 'Submitted', 901);
SELECT public.transition_campaign_atomic(902, 'Approved', 901);
SELECT pg_temp.expect(
  (SELECT approved_by FROM campaigns WHERE id = 902) = 901,
  'approval records the integer id of the approver');
ROLLBACK;

-- ── The conversion path a running database will take ─────────────────────────
-- Above, the columns were already integer, so the migration's conversion block
-- was a no-op. Put a column back the way schema.sql used to declare it and
-- replay the migration, which is what a deployed database does.
BEGIN;
\i supabase/tests/10_fixtures.sql

INSERT INTO auth.users(id, email) VALUES
  ('937d43ae-0f37-4f6d-a53f-9dc957fadad0', 'coordinator@example.test');
-- handle_new_user creates the profile from the auth.users insert above.
INSERT INTO profiles(id, full_name, email, role)
VALUES ('937d43ae-0f37-4f6d-a53f-9dc957fadad0', 'Coordinator', 'coordinator@example.test', 'ProjectManager')
ON CONFLICT (id) DO UPDATE SET email = excluded.email, role = excluded.role;
UPDATE users SET email = 'coordinator@example.test' WHERE id = 901;

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_created_by_fkey;
ALTER TABLE campaigns ALTER COLUMN created_by TYPE uuid USING NULL;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id);
UPDATE campaigns SET created_by = '937d43ae-0f37-4f6d-a53f-9dc957fadad0' WHERE id = 901;

\i supabase/migrations/20260907020000_actor_ids_are_integers.sql

SELECT pg_temp.expect(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='campaigns' AND column_name='created_by') = 'integer',
  'a uuid actor column is converted to integer');
SELECT pg_temp.expect(
  (SELECT created_by FROM campaigns WHERE id = 901) = 901,
  'the existing actor is mapped to its operational user by email, not lost');
SELECT pg_temp.expect(
  (SELECT confrelid::regclass::text FROM pg_constraint
    WHERE conname = 'campaigns_created_by_fkey') = 'users',
  'the foreign key is repointed at users');
ROLLBACK;
