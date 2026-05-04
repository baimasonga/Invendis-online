-- ═══════════════════════════════════════════════════════════════
--  Invendis / Agri-PoD  —  Full Schema + Seed Data
--  Run this once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── MASTER DATA ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.districts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chiefdoms (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  district_id INTEGER NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sections (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  chiefdom_id INTEGER NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.communities (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  section_id  INTEGER NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.value_chains (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.warehouses (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  district_id INTEGER,
  address     TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.distribution_sites (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  district_id     INTEGER,
  community_id    INTEGER,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  geofence_radius DOUBLE PRECISION DEFAULT 500,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── INVENTORY ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.input_items (
  id             SERIAL PRIMARY KEY,
  item_code      TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL,
  category       TEXT,
  value_chain_id INTEGER,
  description    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL,
  input_item_id INTEGER NOT NULL,
  txn_type      TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  reference     TEXT,
  notes         TEXT,
  created_by    INTEGER,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_balance (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL,
  input_item_id INTEGER NOT NULL,
  available     DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved      DOUBLE PRECISION NOT NULL DEFAULT 0,
  loaded        DOUBLE PRECISION NOT NULL DEFAULT 0,
  delivered     DOUBLE PRECISION NOT NULL DEFAULT 0,
  returned      DOUBLE PRECISION NOT NULL DEFAULT 0,
  damaged       DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.procurement_orders (
  id                SERIAL PRIMARY KEY,
  order_code        TEXT NOT NULL UNIQUE,
  supplier_id       INTEGER,
  supplier_name     TEXT,
  warehouse_id      INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'Draft',
  total_amount      DOUBLE PRECISION,
  order_date        TIMESTAMP,
  expected_delivery TIMESTAMP,
  notes             TEXT,
  created_by        INTEGER,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.procurement_items (
  id                SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL,
  input_item_id     INTEGER NOT NULL,
  quantity_ordered  DOUBLE PRECISION NOT NULL,
  quantity_received DOUBLE PRECISION DEFAULT 0,
  unit_cost         DOUBLE PRECISION
);

-- ── FARMERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farmers (
  id               SERIAL PRIMARY KEY,
  farmer_code      TEXT NOT NULL UNIQUE,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  gender           TEXT NOT NULL,
  phone            TEXT,
  national_id      TEXT,
  district_id      INTEGER NOT NULL,
  chiefdom_id      INTEGER,
  section_id       INTEGER,
  community_id     INTEGER,
  value_chain_id   INTEGER NOT NULL,
  farm_size        DOUBLE PRECISION,
  gps_latitude     DOUBLE PRECISION,
  gps_longitude    DOUBLE PRECISION,
  photo_url        TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  barcode_token    TEXT,
  age_group        TEXT,
  farmer_group     TEXT,
  rejection_reason TEXT,
  registered_by    INTEGER,
  approved_by      INTEGER,
  approved_at      TIMESTAMP,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP
);

-- ── CAMPAIGNS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                   SERIAL PRIMARY KEY,
  campaign_code        TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  season               TEXT,
  district_id          INTEGER,
  value_chain_id       INTEGER,
  distribution_site_id INTEGER,
  start_date           TIMESTAMP,
  end_date             TIMESTAMP,
  status               TEXT NOT NULL DEFAULT 'Draft',
  total_farmers        INTEGER DEFAULT 0,
  allocated_farmers    INTEGER DEFAULT 0,
  delivered_count      INTEGER DEFAULT 0,
  notes                TEXT,
  created_by           INTEGER,
  approved_by          INTEGER,
  approved_at          TIMESTAMP,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.campaign_items (
  id                  SERIAL PRIMARY KEY,
  campaign_id         INTEGER NOT NULL,
  input_item_id       INTEGER NOT NULL,
  quantity_per_farmer INTEGER NOT NULL DEFAULT 1,
  unit                TEXT
);

CREATE TABLE IF NOT EXISTS public.allocations (
  id           SERIAL PRIMARY KEY,
  campaign_id  INTEGER NOT NULL,
  farmer_id    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'Pending',
  notes        TEXT,
  allocated_by INTEGER,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP
);

-- ── VEHICLES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicles (
  id             SERIAL PRIMARY KEY,
  vehicle_code   TEXT NOT NULL UNIQUE,
  plate_number   TEXT NOT NULL UNIQUE,
  vehicle_type   TEXT NOT NULL,
  make           TEXT,
  model          TEXT,
  year           INTEGER,
  capacity       DOUBLE PRECISION,
  gps_device_id  TEXT,
  status         TEXT NOT NULL DEFAULT 'Active',
  last_latitude  DOUBLE PRECISION,
  last_longitude DOUBLE PRECISION,
  last_ping      TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.drivers (
  id             SERIAL PRIMARY KEY,
  driver_code    TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  phone          TEXT,
  license_number TEXT,
  license_expiry TIMESTAMP,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.gps_track (
  id          SERIAL PRIMARY KEY,
  vehicle_id  INTEGER NOT NULL,
  dispatch_id INTEGER,
  latitude    DOUBLE PRECISION NOT NULL,
  longitude   DOUBLE PRECISION NOT NULL,
  speed       DOUBLE PRECISION,
  heading     DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── DISPATCH ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dispatches (
  id                  SERIAL PRIMARY KEY,
  manifest_code       TEXT NOT NULL UNIQUE,
  campaign_id         INTEGER NOT NULL,
  vehicle_id          INTEGER NOT NULL,
  driver_id           INTEGER NOT NULL,
  warehouse_id        INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Draft',
  total_packages      INTEGER DEFAULT 0,
  delivered_packages  INTEGER DEFAULT 0,
  notes               TEXT,
  departed_at         TIMESTAMP,
  arrived_at          TIMESTAMP,
  created_by          INTEGER,
  approved_by         INTEGER,
  approved_at         TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.dispatch_items (
  id                  SERIAL PRIMARY KEY,
  dispatch_id         INTEGER NOT NULL,
  input_item_id       INTEGER NOT NULL,
  quantity_loaded     DOUBLE PRECISION NOT NULL,
  quantity_delivered  DOUBLE PRECISION DEFAULT 0,
  quantity_returned   DOUBLE PRECISION DEFAULT 0
);

-- ── PROOF OF DELIVERY ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pod (
  id                  SERIAL PRIMARY KEY,
  pod_code            TEXT NOT NULL UNIQUE,
  farmer_id           INTEGER NOT NULL,
  campaign_id         INTEGER NOT NULL,
  dispatch_id         INTEGER,
  field_officer_id    INTEGER,
  quantity_delivered  DOUBLE PRECISION,
  otp_status          TEXT DEFAULT 'Pending',
  face_status         TEXT DEFAULT 'Pending',
  gps_status          TEXT DEFAULT 'Pending',
  vehicle_gps_status  TEXT DEFAULT 'Pending',
  status              TEXT NOT NULL DEFAULT 'Pending',
  farmer_latitude     DOUBLE PRECISION,
  farmer_longitude    DOUBLE PRECISION,
  vehicle_latitude    DOUBLE PRECISION,
  vehicle_longitude   DOUBLE PRECISION,
  photo_url           TEXT,
  signature_url       TEXT,
  notes               TEXT,
  exception_reason    TEXT,
  approved_by         INTEGER,
  approved_at         TIMESTAMP,
  submitted_at        TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── RECONCILIATION ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliations (
  id                    SERIAL PRIMARY KEY,
  reconciliation_code   TEXT NOT NULL UNIQUE,
  dispatch_id           INTEGER NOT NULL,
  warehouse_id          INTEGER NOT NULL,
  loaded_quantity       DOUBLE PRECISION,
  delivered_quantity    DOUBLE PRECISION,
  returned_quantity     DOUBLE PRECISION,
  damaged_quantity      DOUBLE PRECISION,
  variance_quantity     DOUBLE PRECISION,
  status                TEXT NOT NULL DEFAULT 'Draft',
  notes                 TEXT,
  created_by            INTEGER,
  approved_by           INTEGER,
  approved_at           TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER,
  username    TEXT,
  action      TEXT NOT NULL,
  module      TEXT NOT NULL,
  description TEXT,
  entity_type TEXT,
  entity_id   INTEGER,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── USERS (legacy — kept for API server) ────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'FieldOfficer',
  district_id   INTEGER,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY  — allow authenticated users full access
-- ═══════════════════════════════════════════════════════════════
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'districts','chiefdoms','sections','communities','value_chains',
    'warehouses','distribution_sites','input_items','stock_ledger',
    'stock_balance','procurement_orders','procurement_items',
    'farmers','campaigns','campaign_items','allocations',
    'vehicles','drivers','gps_track','dispatches','dispatch_items',
    'pod','reconciliations','audit_logs','users'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($$
      CREATE POLICY "authenticated_full_access" ON public.%I
      FOR ALL TO authenticated USING (true) WITH CHECK (true)
    $$, t);
    EXECUTE format($$
      CREATE POLICY "service_role_full_access" ON public.%I
      FOR ALL TO service_role USING (true) WITH CHECK (true)
    $$, t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
--  SEED DATA — Sierra Leone districts, value chains, warehouses
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.districts (name, code) VALUES
  ('Western Area Urban', 'WAU'),
  ('Western Area Rural', 'WAR'),
  ('Bo',                 'BO'),
  ('Kenema',             'KEN'),
  ('Kailahun',           'KAL'),
  ('Kono',               'KNO'),
  ('Bombali',            'BOM'),
  ('Kambia',             'KAM'),
  ('Koinadugu',          'KOI'),
  ('Moyamba',            'MOY'),
  ('Pujehun',            'PUJ'),
  ('Port Loko',          'PLK'),
  ('Tonkolili',          'TON'),
  ('Falaba',             'FAL')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.value_chains (name, description) VALUES
  ('Rice',       'Rice cultivation and distribution'),
  ('Cassava',    'Cassava value chain'),
  ('Maize',      'Maize / corn cultivation'),
  ('Groundnut',  'Groundnut cultivation'),
  ('Vegetables', 'Horticulture and vegetable farming')
ON CONFLICT DO NOTHING;

INSERT INTO public.warehouses (name, code, district_id, address) VALUES
  ('Central Warehouse – Freetown', 'WH-FTN', 1, 'Freetown, Western Area Urban'),
  ('Bo Regional Warehouse',        'WH-BO',  3, 'Bo Town, Bo District'),
  ('Kenema Regional Warehouse',    'WH-KEN', 4, 'Kenema, Kenema District'),
  ('Port Loko Warehouse',          'WH-PLK', 12,'Port Loko, Port Loko District')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.input_items (item_code, name, unit, category, value_chain_id) VALUES
  ('FERT-001', 'NPK Fertilizer (50kg)',  'Bag',  'Fertilizer', 1),
  ('FERT-002', 'Urea Fertilizer (50kg)', 'Bag',  'Fertilizer', 1),
  ('SEED-001', 'Improved Rice Seed',     'Kg',   'Seed',       1),
  ('SEED-002', 'Cassava Cuttings',       'Bundle','Seed',      2),
  ('SEED-003', 'Maize Seed (5kg)',       'Bag',  'Seed',       3),
  ('TOOL-001', 'Hand Hoe',               'Unit', 'Tools',      NULL),
  ('TOOL-002', 'Watering Can',           'Unit', 'Tools',      NULL),
  ('CHEM-001', 'Herbicide (1L)',         'Litre','Chemical',   NULL)
ON CONFLICT (item_code) DO NOTHING;

