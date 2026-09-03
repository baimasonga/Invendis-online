-- ============================================================
-- Invendis / Agri-PoD  –  Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- AFTER running this, create your first admin user at:
--   Supabase Dashboard > Authentication > Users > Add user
--   email: admin@invendis.com  password: (your choice)
-- Then update their role:
--   UPDATE profiles SET role = 'Admin' WHERE email = 'admin@invendis.com';
-- ============================================================

-- ── PROFILES (extends auth.users) ──────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL DEFAULT '',
  email       text,
  username    text UNIQUE,
  role        text NOT NULL DEFAULT 'FieldOfficer',
  district_id integer,
  is_active   boolean NOT NULL DEFAULT true,
  last_login  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    COALESCE(new.raw_user_meta_data->>'role', 'FieldOfficer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── GEOGRAPHY ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS districts (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  code       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chiefdoms (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  district_id integer NOT NULL REFERENCES districts(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  chiefdom_id  integer NOT NULL REFERENCES chiefdoms(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communities (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  section_id  integer NOT NULL REFERENCES sections(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS value_chains (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  description text,
  is_active   integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  code        text NOT NULL UNIQUE,
  district_id integer REFERENCES districts(id),
  address     text,
  latitude    double precision,
  longitude   double precision,
  is_active   integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS distribution_sites (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  district_id     integer REFERENCES districts(id),
  community_id    integer REFERENCES communities(id),
  latitude        double precision,
  longitude       double precision,
  geofence_radius double precision DEFAULT 500,
  is_active       integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── FARMERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS farmers (
  id               serial PRIMARY KEY,
  farmer_code      text NOT NULL UNIQUE DEFAULT '',
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  gender           text NOT NULL,
  phone            text,
  national_id      text,
  district_id      integer REFERENCES districts(id),
  chiefdom_id      integer REFERENCES chiefdoms(id),
  section_id       integer REFERENCES sections(id),
  community_id     integer REFERENCES communities(id),
  value_chain_id   integer REFERENCES value_chains(id),
  farm_size        double precision,
  gps_latitude     double precision,
  gps_longitude    double precision,
  photo_url        text,
  status           text NOT NULL DEFAULT 'pending',
  barcode_token    text,
  age_group        text,
  farmer_group     text,
  rejection_reason text,
  registered_by    uuid REFERENCES profiles(id),
  approved_by      uuid REFERENCES profiles(id),
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);

CREATE OR REPLACE FUNCTION generate_farmer_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; code text;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM farmers;
  code := 'FMR-' || LPAD(n::text, 5, '0');
  WHILE EXISTS(SELECT 1 FROM farmers WHERE farmer_code = code) LOOP
    n := n + 1; code := 'FMR-' || LPAD(n::text, 5, '0');
  END LOOP;
  new.farmer_code := code;
  RETURN new;
END; $$;

DROP TRIGGER IF EXISTS set_farmer_code ON farmers;
CREATE TRIGGER set_farmer_code
  BEFORE INSERT ON farmers FOR EACH ROW
  WHEN (new.farmer_code IS NULL OR new.farmer_code = '')
  EXECUTE FUNCTION generate_farmer_code();

-- ── INVENTORY ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS input_items (
  id             serial PRIMARY KEY,
  item_code      text NOT NULL UNIQUE,
  name           text NOT NULL,
  unit           text NOT NULL,
  category       text,
  value_chain_id integer REFERENCES value_chains(id),
  description    text,
  is_active      integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_ledger (
  id            serial PRIMARY KEY,
  warehouse_id  integer NOT NULL REFERENCES warehouses(id),
  input_item_id integer NOT NULL REFERENCES input_items(id),
  txn_type      text NOT NULL,
  quantity      double precision NOT NULL,
  reference     text,
  notes         text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_balance (
  id            serial PRIMARY KEY,
  warehouse_id  integer NOT NULL REFERENCES warehouses(id),
  input_item_id integer NOT NULL REFERENCES input_items(id),
  available     double precision NOT NULL DEFAULT 0,
  reserved      double precision NOT NULL DEFAULT 0,
  loaded        double precision NOT NULL DEFAULT 0,
  delivered     double precision NOT NULL DEFAULT 0,
  returned      double precision NOT NULL DEFAULT 0,
  damaged       double precision NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_orders (
  id                serial PRIMARY KEY,
  order_code        text NOT NULL UNIQUE DEFAULT '',
  supplier_id       integer,
  supplier_name     text,
  warehouse_id      integer REFERENCES warehouses(id),
  status            text NOT NULL DEFAULT 'Draft',
  total_amount      double precision,
  order_date        timestamptz,
  expected_delivery timestamptz,
  notes             text,
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz
);

CREATE OR REPLACE FUNCTION generate_order_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.order_code := 'PO-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_order_code ON procurement_orders;
CREATE TRIGGER set_order_code BEFORE INSERT ON procurement_orders FOR EACH ROW
  WHEN (new.order_code IS NULL OR new.order_code = '') EXECUTE FUNCTION generate_order_code();

CREATE TABLE IF NOT EXISTS procurement_items (
  id                serial PRIMARY KEY,
  order_id          integer NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
  input_item_id     integer NOT NULL REFERENCES input_items(id),
  quantity_ordered  double precision NOT NULL,
  quantity_received double precision DEFAULT 0,
  unit_cost         double precision
);

-- ── CAMPAIGNS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id                   serial PRIMARY KEY,
  campaign_code        text NOT NULL UNIQUE DEFAULT '',
  name                 text NOT NULL,
  season               text,
  district_id          integer REFERENCES districts(id),
  value_chain_id       integer REFERENCES value_chains(id),
  distribution_site_id integer REFERENCES distribution_sites(id),
  start_date           timestamptz,
  end_date             timestamptz,
  status               text NOT NULL DEFAULT 'Draft',
  total_farmers        integer DEFAULT 0,
  allocated_farmers    integer DEFAULT 0,
  delivered_count      integer DEFAULT 0,
  notes                text,
  created_by           uuid REFERENCES profiles(id),
  approved_by          uuid REFERENCES profiles(id),
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz
);

CREATE OR REPLACE FUNCTION generate_campaign_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.campaign_code := 'CAM-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_campaign_code ON campaigns;
CREATE TRIGGER set_campaign_code BEFORE INSERT ON campaigns FOR EACH ROW
  WHEN (new.campaign_code IS NULL OR new.campaign_code = '') EXECUTE FUNCTION generate_campaign_code();

CREATE TABLE IF NOT EXISTS campaign_items (
  id                  serial PRIMARY KEY,
  campaign_id         integer NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  input_item_id       integer NOT NULL REFERENCES input_items(id),
  quantity_per_farmer integer NOT NULL DEFAULT 1,
  unit                text
);

CREATE TABLE IF NOT EXISTS allocations (
  id           serial PRIMARY KEY,
  campaign_id  integer NOT NULL REFERENCES campaigns(id),
  farmer_id    integer NOT NULL REFERENCES farmers(id),
  status       text NOT NULL DEFAULT 'Pending',
  notes        text,
  allocated_by uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz
);

-- ── VEHICLES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id             serial PRIMARY KEY,
  vehicle_code   text NOT NULL UNIQUE DEFAULT '',
  plate_number   text NOT NULL UNIQUE,
  vehicle_type   text NOT NULL,
  make           text,
  model          text,
  year           integer,
  capacity       double precision,
  gps_device_id  text,
  status         text NOT NULL DEFAULT 'Active',
  last_latitude  double precision,
  last_longitude double precision,
  last_ping      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_vehicle_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.vehicle_code := 'VEH-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_vehicle_code ON vehicles;
CREATE TRIGGER set_vehicle_code BEFORE INSERT ON vehicles FOR EACH ROW
  WHEN (new.vehicle_code IS NULL OR new.vehicle_code = '') EXECUTE FUNCTION generate_vehicle_code();

CREATE TABLE IF NOT EXISTS drivers (
  id             serial PRIMARY KEY,
  driver_code    text NOT NULL UNIQUE DEFAULT '',
  full_name      text NOT NULL,
  phone          text,
  license_number text,
  license_expiry timestamptz,
  is_active      integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_driver_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.driver_code := 'DRV-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_driver_code ON drivers;
CREATE TRIGGER set_driver_code BEFORE INSERT ON drivers FOR EACH ROW
  WHEN (new.driver_code IS NULL OR new.driver_code = '') EXECUTE FUNCTION generate_driver_code();

CREATE TABLE IF NOT EXISTS gps_track (
  id          serial PRIMARY KEY,
  vehicle_id  integer NOT NULL REFERENCES vehicles(id),
  dispatch_id integer,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  speed       double precision,
  heading     double precision,
  accuracy    double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- ── DISPATCH ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dispatches (
  id                  serial PRIMARY KEY,
  manifest_code       text NOT NULL UNIQUE DEFAULT '',
  campaign_id         integer NOT NULL REFERENCES campaigns(id),
  vehicle_id          integer NOT NULL REFERENCES vehicles(id),
  driver_id           integer NOT NULL REFERENCES drivers(id),
  warehouse_id        integer NOT NULL REFERENCES warehouses(id),
  status              text NOT NULL DEFAULT 'Draft',
  total_packages      integer DEFAULT 0,
  delivered_packages  integer DEFAULT 0,
  notes               text,
  departed_at         timestamptz,
  arrived_at          timestamptz,
  created_by          uuid REFERENCES profiles(id),
  approved_by         uuid REFERENCES profiles(id),
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz
);

CREATE OR REPLACE FUNCTION generate_manifest_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.manifest_code := 'MAN-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_manifest_code ON dispatches;
CREATE TRIGGER set_manifest_code BEFORE INSERT ON dispatches FOR EACH ROW
  WHEN (new.manifest_code IS NULL OR new.manifest_code = '') EXECUTE FUNCTION generate_manifest_code();

CREATE TABLE IF NOT EXISTS dispatch_items (
  id                 serial PRIMARY KEY,
  dispatch_id        integer NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  input_item_id      integer NOT NULL REFERENCES input_items(id),
  quantity_loaded    double precision NOT NULL,
  quantity_delivered double precision DEFAULT 0,
  quantity_returned  double precision DEFAULT 0
);

-- ── PROOF OF DELIVERY ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pod (
  id                  serial PRIMARY KEY,
  pod_code            text NOT NULL UNIQUE DEFAULT '',
  farmer_id           integer NOT NULL REFERENCES farmers(id),
  campaign_id         integer NOT NULL REFERENCES campaigns(id),
  dispatch_id         integer REFERENCES dispatches(id),
  field_officer_id    uuid REFERENCES profiles(id),
  quantity_delivered  double precision,
  otp_status          text DEFAULT 'Pending',
  face_status         text DEFAULT 'Pending',
  gps_status          text DEFAULT 'Pending',
  vehicle_gps_status  text DEFAULT 'Pending',
  status              text NOT NULL DEFAULT 'Pending',
  farmer_latitude     double precision,
  farmer_longitude    double precision,
  vehicle_latitude    double precision,
  vehicle_longitude   double precision,
  photo_url           text,
  signature_url       text,
  notes               text,
  exception_reason    text,
  approved_by         uuid REFERENCES profiles(id),
  approved_at         timestamptz,
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_pod_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.pod_code := 'POD-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_pod_code ON pod;
CREATE TRIGGER set_pod_code BEFORE INSERT ON pod FOR EACH ROW
  WHEN (new.pod_code IS NULL OR new.pod_code = '') EXECUTE FUNCTION generate_pod_code();

-- ── RECONCILIATION ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliations (
  id                    serial PRIMARY KEY,
  reconciliation_code   text NOT NULL UNIQUE DEFAULT '',
  dispatch_id           integer NOT NULL REFERENCES dispatches(id),
  warehouse_id          integer NOT NULL REFERENCES warehouses(id),
  loaded_quantity       double precision,
  delivered_quantity    double precision,
  returned_quantity     double precision,
  damaged_quantity      double precision,
  variance_quantity     double precision,
  status                text NOT NULL DEFAULT 'Draft',
  notes                 text,
  created_by            uuid REFERENCES profiles(id),
  approved_by           uuid REFERENCES profiles(id),
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_recon_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.reconciliation_code := 'REC-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_recon_code ON reconciliations;
CREATE TRIGGER set_recon_code BEFORE INSERT ON reconciliations FOR EACH ROW
  WHEN (new.reconciliation_code IS NULL OR new.reconciliation_code = '') EXECUTE FUNCTION generate_recon_code();

-- ── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          serial PRIMARY KEY,
  user_id     uuid REFERENCES profiles(id),
  username    text,
  action      text NOT NULL,
  module      text NOT NULL,
  description text,
  entity_type text,
  entity_id   integer,
  ip_address  text,
  metadata    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── USERS (legacy — for mobile JWT auth) ─────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  email         text,
  role          text NOT NULL DEFAULT 'FieldOfficer',
  district_id   integer,
  is_active     boolean NOT NULL DEFAULT true,
  last_login    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

-- ── INCIDENTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incidents (
  id               serial PRIMARY KEY,
  incident_code    text NOT NULL UNIQUE,
  type             text,
  title            text,
  description      text,
  dispatch_id      integer REFERENCES dispatches(id),
  field_officer_id integer REFERENCES users(id),
  reported_by      text,
  latitude         double precision,
  longitude        double precision,
  photo_url        text,
  status           text NOT NULL DEFAULT 'Open',
  resolution_notes text,
  resolved_by      integer REFERENCES users(id),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_status_idx        ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_field_officer_idx ON incidents (field_officer_id);

-- ── OTP CODES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         serial PRIMARY KEY,
  farmer_id  integer NOT NULL REFERENCES farmers(id),
  code_hash  text NOT NULL,
  channel    text NOT NULL DEFAULT 'none',
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_codes_farmer_id_idx  ON otp_codes (farmer_id);
CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx ON otp_codes (expires_at);

-- ── SYSTEM SETTINGS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key         text PRIMARY KEY,
  value       text,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value, description) VALUES
  ('otp_enabled',            'true',    'Enable OTP verification for PoD confirmation'),
  ('face_verify_enabled',    'true',    'Enable face verification for PoD confirmation'),
  ('geofence_radius_m',      '500',     'Default geofence radius in metres for GPS verification'),
  ('sms_sender_name',        'AgriPoD', 'Sender name shown on OTP SMS messages (max 11 chars)'),
  ('otp_expiry_minutes',     '10',      'OTP code expiry time in minutes'),
  ('otp_max_attempts',       '5',       'Maximum OTP verification attempts before lockout'),
  ('otp_rate_limit_seconds', '60',      'Minimum seconds between OTP send requests per farmer')
ON CONFLICT (key) DO NOTHING;

-- ── PERFORMANCE INDEXES ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS farmers_status_idx        ON farmers (status);
CREATE INDEX IF NOT EXISTS farmers_barcode_token_idx ON farmers (barcode_token);
CREATE INDEX IF NOT EXISTS farmers_district_id_idx   ON farmers (district_id);

CREATE INDEX IF NOT EXISTS pod_farmer_id_idx   ON pod (farmer_id);
CREATE INDEX IF NOT EXISTS pod_dispatch_id_idx ON pod (dispatch_id);
CREATE INDEX IF NOT EXISTS pod_status_idx      ON pod (status);
CREATE INDEX IF NOT EXISTS pod_campaign_id_idx ON pod (campaign_id);

CREATE INDEX IF NOT EXISTS gps_track_vehicle_id_idx  ON gps_track (vehicle_id);
CREATE INDEX IF NOT EXISTS gps_track_recorded_at_idx ON gps_track (recorded_at DESC);

CREATE INDEX IF NOT EXISTS allocations_campaign_id_idx ON allocations (campaign_id);
CREATE INDEX IF NOT EXISTS allocations_farmer_id_idx   ON allocations (farmer_id);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx           ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_type_entity_id_idx ON audit_logs (entity_type, entity_id);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
DO $$ DECLARE t text;
BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
  EXECUTE 'ALTER TABLE ' || t || ' ENABLE ROW LEVEL SECURITY';
END LOOP; END; $$;

-- Role lookups live outside the exposed public schema. The function returns
-- NULL for missing or deactivated profiles, which denies every policy below.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_profile_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT lower(regexp_replace(p.role, '[\s_-]', '', 'g'))
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid()) AND p.is_active = true
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.current_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.current_profile_role() TO authenticated;

-- Remove policies from earlier schema versions before defining least-privilege
-- access. Profiles cannot be updated directly by browser clients.
DO $$ DECLARE p record;
BEGIN FOR p IN
  SELECT tablename, policyname FROM pg_policies
  WHERE schemaname = 'public' AND (
    policyname LIKE 'auth_all_%' OR
    policyname IN ('profiles_select', 'profiles_update_own') OR
    policyname LIKE 'invendis_%'
  )
LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
END LOOP; END; $$;

CREATE POLICY invendis_profiles_read ON profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.current_profile_role()) = 'admin');

-- Preserve read access expected by the portal, but only for active accounts.
DO $$ DECLARE t text;
BEGIN FOREACH t IN ARRAY ARRAY[
  'districts','chiefdoms','sections','communities','value_chains','warehouses',
  'distribution_sites','farmers','input_items','stock_ledger','stock_balance',
  'procurement_orders','procurement_items','campaigns','campaign_items',
  'allocations','vehicles','drivers','gps_track','dispatches','dispatch_items',
  'pod','reconciliations','audit_logs','users','incidents','otp_codes','system_settings'
] LOOP
  EXECUTE format(
    'CREATE POLICY invendis_active_read ON public.%I FOR SELECT TO authenticated USING ((SELECT private.current_profile_role()) IS NOT NULL)', t
  );
END LOOP; END; $$;

-- Write roles mirror artifacts/web-portal/src/hooks/use-permissions.ts.
DO $$ DECLARE a record;
BEGIN FOR a IN SELECT * FROM (VALUES
  ('farmers',             ARRAY['admin','projectmanager','districtcoordinator']::text[]),
  ('allocations',         ARRAY['admin','projectmanager','districtcoordinator']::text[]),
  ('incidents',           ARRAY['admin','projectmanager','districtcoordinator']::text[]),
  ('campaigns',           ARRAY['admin','projectmanager']::text[]),
  ('campaign_items',      ARRAY['admin','projectmanager']::text[]),
  ('input_items',         ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('stock_ledger',        ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('stock_balance',       ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('procurement_orders',  ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('procurement_items',   ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('vehicles',            ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('drivers',             ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('dispatches',          ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('dispatch_items',      ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('reconciliations',     ARRAY['admin','projectmanager','warehousemanager']::text[]),
  ('pod',                 ARRAY['admin','projectmanager','districtcoordinator','warehousemanager']::text[]),
  ('districts',           ARRAY['admin','projectmanager']::text[]),
  ('chiefdoms',           ARRAY['admin','projectmanager']::text[]),
  ('sections',            ARRAY['admin','projectmanager']::text[]),
  ('communities',         ARRAY['admin','projectmanager']::text[]),
  ('value_chains',        ARRAY['admin','projectmanager']::text[]),
  ('warehouses',          ARRAY['admin','projectmanager']::text[]),
  ('distribution_sites',  ARRAY['admin','projectmanager']::text[]),
  ('system_settings',     ARRAY['admin','projectmanager']::text[])
) AS access(table_name, roles)
LOOP
  EXECUTE format('CREATE POLICY invendis_role_insert ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT private.current_profile_role()) = ANY (%L::text[]))', a.table_name, a.roles);
  EXECUTE format('CREATE POLICY invendis_role_update ON public.%I FOR UPDATE TO authenticated USING ((SELECT private.current_profile_role()) = ANY (%L::text[])) WITH CHECK ((SELECT private.current_profile_role()) = ANY (%L::text[]))', a.table_name, a.roles, a.roles);
  EXECUTE format('CREATE POLICY invendis_role_delete ON public.%I FOR DELETE TO authenticated USING ((SELECT private.current_profile_role()) = ANY (%L::text[]))', a.table_name, a.roles);
END LOOP; END; $$;

-- Receive stock and update its balance in one transaction.
CREATE OR REPLACE FUNCTION public.receive_stock_atomic(
  p_warehouse_id integer, p_input_item_id integer, p_quantity double precision,
  p_reference text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS SETOF public.stock_ledger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE balance_id integer; ledger_row public.stock_ledger;
BEGIN
  IF NOT coalesce((SELECT private.current_profile_role()) = ANY (ARRAY['admin','projectmanager','warehousemanager']), false) THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(p_warehouse_id, p_input_item_id);
  SELECT sb.id INTO balance_id FROM public.stock_balance sb
  WHERE sb.warehouse_id = p_warehouse_id AND sb.input_item_id = p_input_item_id
  ORDER BY sb.id LIMIT 1 FOR UPDATE;
  IF balance_id IS NULL THEN
    INSERT INTO public.stock_balance (warehouse_id,input_item_id,available)
    VALUES (p_warehouse_id,p_input_item_id,p_quantity);
  ELSE
    UPDATE public.stock_balance SET available = available + p_quantity, updated_at = pg_catalog.now()
    WHERE id = balance_id;
  END IF;
  INSERT INTO public.stock_ledger (warehouse_id,input_item_id,txn_type,quantity,reference,notes)
  VALUES (p_warehouse_id,p_input_item_id,'RECEIVE',p_quantity,p_reference,p_notes)
  RETURNING * INTO ledger_row;
  RETURN NEXT ledger_row;
END $$;
REVOKE ALL ON FUNCTION public.receive_stock_atomic(integer,integer,double precision,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_stock_atomic(integer,integer,double precision,text,text) TO authenticated;

-- ── SEED DATA ────────────────────────────────────────────────
INSERT INTO districts (name, code) VALUES
  ('Bo','BO'),('Bonthe','BT'),('Falaba','FA'),('Kailahun','KL'),
  ('Kambia','KA'),('Karene','KR'),('Kenema','KE'),('Koinadugu','KO'),
  ('Kono','KN'),('Moyamba','MO'),('Port Loko','PL'),('Pujehun','PJ'),
  ('Tonkolili','TK'),('Western Area Rural','WR'),('Western Area Urban','WU')
ON CONFLICT (code) DO NOTHING;

INSERT INTO value_chains (name, description) VALUES
  ('Rice','Staple grain production'),
  ('Cassava','Root crop production'),
  ('Cocoa','Export cash crop'),
  ('Coffee','Export cash crop'),
  ('Groundnut','Legume / oil crop')
ON CONFLICT DO NOTHING;

INSERT INTO warehouses (name, code, is_active) VALUES
  ('Bo Central Store','WH-BO-01',1),
  ('Kenema Regional Hub','WH-KE-01',1),
  ('Makeni Distribution Centre','WH-MK-01',1),
  ('Freetown Port Store','WH-FT-01',1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO input_items (item_code, name, unit, category, is_active) VALUES
  ('RICE-SED-50KG','Improved Rice Seed 50kg','bag','seed',1),
  ('FERT-NPK-50KG','NPK Fertilizer 50kg','bag','fertilizer',1),
  ('FERT-UREA-50KG','Urea Fertilizer 50kg','bag','fertilizer',1),
  ('AGRO-HERB-1L','Herbicide 1L','bottle','chemical',1)
ON CONFLICT (item_code) DO NOTHING;
