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

-- ── ROLE HELPER FUNCTIONS ────────────────────────────────────
-- SECURITY DEFINER so these run as the function owner, not the calling role,
-- preventing infinite recursion when profiles itself is RLS-protected.
CREATE OR REPLACE FUNCTION auth_user_role()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_district_id()
  RETURNS integer LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT district_id FROM profiles WHERE id = auth.uid()
$$;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
DO $$ DECLARE t text;
BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
  EXECUTE 'ALTER TABLE ' || t || ' ENABLE ROW LEVEL SECURITY';
END LOOP; END; $$;

-- Profiles: read all authenticated; update own record only
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Farmers: Admins/PMs see all; FieldOfficers see own district only
DROP POLICY IF EXISTS "auth_all_farmers" ON farmers;
DROP POLICY IF EXISTS "farmers_access" ON farmers;
CREATE POLICY "farmers_access" ON farmers FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR district_id = auth_user_district_id()
);

-- Campaigns: Admins/PMs see all; FieldOfficers see own district
DROP POLICY IF EXISTS "auth_all_campaigns" ON campaigns;
DROP POLICY IF EXISTS "campaigns_access" ON campaigns;
CREATE POLICY "campaigns_access" ON campaigns FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR district_id = auth_user_district_id()
);

-- Allocations: scoped to campaign's district
DROP POLICY IF EXISTS "auth_all_allocations" ON allocations;
DROP POLICY IF EXISTS "allocations_access" ON allocations;
CREATE POLICY "allocations_access" ON allocations FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_id AND c.district_id = auth_user_district_id()
  )
);

-- Campaign items: scoped to campaign's district
DROP POLICY IF EXISTS "auth_all_campaign_items" ON campaign_items;
DROP POLICY IF EXISTS "campaign_items_access" ON campaign_items;
CREATE POLICY "campaign_items_access" ON campaign_items FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.id = campaign_id AND c.district_id = auth_user_district_id()
  )
);

-- Dispatches: scoped to campaign's district
DROP POLICY IF EXISTS "auth_all_dispatches" ON dispatches;
DROP POLICY IF EXISTS "dispatches_access" ON dispatches;
CREATE POLICY "dispatches_access" ON dispatches FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM campaigns c WHERE c.id = campaign_id
    AND c.district_id = auth_user_district_id()
  )
);

-- Dispatch items: scoped via dispatch → campaign district
DROP POLICY IF EXISTS "auth_all_dispatch_items" ON dispatch_items;
DROP POLICY IF EXISTS "dispatch_items_access" ON dispatch_items;
CREATE POLICY "dispatch_items_access" ON dispatch_items FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM dispatches d
    JOIN campaigns c ON c.id = d.campaign_id
    WHERE d.id = dispatch_id AND c.district_id = auth_user_district_id()
  )
);

-- PoD: scoped via farmer's district
DROP POLICY IF EXISTS "auth_all_pod" ON pod;
DROP POLICY IF EXISTS "pod_access" ON pod;
CREATE POLICY "pod_access" ON pod FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM farmers f
    WHERE f.id = farmer_id AND f.district_id = auth_user_district_id()
  )
);

-- Incidents: by district_id column
DROP POLICY IF EXISTS "auth_all_incidents" ON incidents;
DROP POLICY IF EXISTS "incidents_access" ON incidents;
CREATE POLICY "incidents_access" ON incidents FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR district_id = auth_user_district_id()
);

-- OTP codes: scoped via farmer's district
DROP POLICY IF EXISTS "auth_all_otp_codes" ON otp_codes;
DROP POLICY IF EXISTS "otp_codes_access" ON otp_codes;
CREATE POLICY "otp_codes_access" ON otp_codes FOR ALL USING (
  auth_user_role() IN ('Admin', 'ProjectManager')
  OR EXISTS (
    SELECT 1 FROM farmers f
    WHERE f.id = farmer_id AND f.district_id = auth_user_district_id()
  )
);

-- Audit logs: Admin only via web portal; api-server writes via service role (bypasses RLS)
DROP POLICY IF EXISTS "auth_all_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_access" ON audit_logs;
CREATE POLICY "audit_logs_access" ON audit_logs FOR ALL USING (
  auth_user_role() = 'Admin'
);

-- Users table: all authenticated can read (for profile display); Admins/PMs can write
DROP POLICY IF EXISTS "auth_all_users" ON users;
DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_write" ON users;
CREATE POLICY "users_select" ON users FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "users_write"  ON users FOR ALL    USING (auth_user_role() IN ('Admin', 'ProjectManager'));

-- Reference/lookup tables: all authenticated can read; Admins/PMs can write
DO $$ DECLARE t text;
BEGIN FOR t IN
  SELECT unnest(ARRAY['districts','chiefdoms','sections','communities',
                       'value_chains','warehouses','input_items',
                       'vehicles','drivers','distribution_sites'])
LOOP
  EXECUTE 'DROP POLICY IF EXISTS "auth_all_' || t || '" ON ' || t;
  EXECUTE 'DROP POLICY IF EXISTS "ref_read_' || t || '" ON ' || t;
  EXECUTE 'DROP POLICY IF EXISTS "ref_write_' || t || '" ON ' || t;
  EXECUTE 'CREATE POLICY "ref_read_' || t || '" ON ' || t
       || ' FOR SELECT USING (auth.role() = ''authenticated'')';
  EXECUTE 'CREATE POLICY "ref_write_' || t || '" ON ' || t
       || ' FOR ALL USING (auth_user_role() IN (''Admin'', ''ProjectManager''))';
END LOOP; END; $$;

-- Stock/inventory/reconciliation/GPS: all authenticated (cross-district operations)
DO $$ DECLARE t text;
BEGIN FOR t IN
  SELECT unnest(ARRAY['stock_ledger','stock_balance','procurement_orders',
                       'procurement_items','reconciliations','gps_track'])
LOOP
  EXECUTE 'DROP POLICY IF EXISTS "auth_all_' || t || '" ON ' || t;
  EXECUTE 'CREATE POLICY "auth_all_' || t || '" ON ' || t
       || ' FOR ALL USING (auth.role() = ''authenticated'')';
END LOOP; END; $$;

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
