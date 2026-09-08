-- The portal and mobile API must agree on integer operational user ids.
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
    WHERE table_schema='public' AND table_name='dispatches'
      AND column_name='field_officer_id') = 'integer',
  'dispatch ownership uses an integer operational user id');
SELECT pg_temp.expect(
  (SELECT ccu.table_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema=tc.constraint_schema AND kcu.constraint_name=tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema=tc.constraint_schema AND ccu.constraint_name=tc.constraint_name
   WHERE tc.table_schema='public' AND tc.table_name='dispatches'
     AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='field_officer_id') = 'users',
  'dispatch ownership references users');
ROLLBACK;

-- Reproduce the deployed UUID drift and prove that an existing assignment is
-- mapped rather than nulled during conversion.
BEGIN;
\i supabase/tests/10_fixtures.sql
INSERT INTO auth.users(id, email) VALUES
  ('937d43ae-0f37-4f6d-a53f-9dc957fadad0', 'field@example.test');
INSERT INTO profiles(id, full_name, email, role)
VALUES ('937d43ae-0f37-4f6d-a53f-9dc957fadad0', 'Field Officer', 'field@example.test', 'FieldOfficer')
ON CONFLICT (id) DO UPDATE SET email=excluded.email;
UPDATE users SET email='field@example.test' WHERE id=903;
UPDATE campaigns SET status='Approved' WHERE id=901;

ALTER TABLE dispatches DROP CONSTRAINT IF EXISTS dispatches_field_officer_id_fkey;
DROP TRIGGER IF EXISTS dispatch_requires_field_officer ON dispatches;
ALTER TABLE dispatches ALTER COLUMN field_officer_id TYPE uuid USING NULL;
ALTER TABLE dispatches ADD CONSTRAINT dispatches_field_officer_id_fkey
  FOREIGN KEY(field_officer_id) REFERENCES profiles(id);
CREATE TRIGGER dispatch_requires_field_officer
  BEFORE INSERT OR UPDATE OF status, field_officer_id ON dispatches
  FOR EACH ROW EXECUTE FUNCTION require_dispatch_field_officer_on_start();
INSERT INTO dispatches(id,campaign_id,warehouse_id,vehicle_id,driver_id,field_officer_id,status)
VALUES (975,901,901,901,901,'937d43ae-0f37-4f6d-a53f-9dc957fadad0','Draft');

\i supabase/migrations/20260908090000_fix_dispatch_field_officer_contract.sql

SELECT pg_temp.expect(
  (SELECT field_officer_id FROM dispatches WHERE id=975)=903,
  'an existing profile assignment maps to its operational user');
SELECT pg_temp.expect(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dispatches'
      AND column_name='field_officer_id')='integer',
  'the drifted UUID column is converted to integer');
SELECT pg_temp.expect(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.dispatches'::regclass
           AND tgname='dispatch_requires_field_officer'),
  'the dispatch readiness trigger survives conversion');
ROLLBACK;
