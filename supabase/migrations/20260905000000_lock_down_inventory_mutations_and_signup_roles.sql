-- Remove direct inventory mutation paths and prevent role escalation through
-- auth sign-up metadata. This is a follow-up for databases that already ran
-- the September web-security migration.

BEGIN;

-- Drop every browser-facing stock write policy, including policies installed
-- by prior releases under a different name. Existing read policies are kept.
-- service_role bypasses RLS and is the sole caller of the validated atomic
-- inventory RPCs.
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('stock_balance', 'stock_ledger')
      AND cmd <> 'SELECT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['stock_balance', 'stock_ledger']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        table_name
      );
      EXECUTE format(
        'GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- Metadata belongs to the person registering and must not be treated as an
-- authorization claim. Direct database/service role changes remain available
-- for administrator-driven provisioning.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'FieldOfficer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

COMMIT;