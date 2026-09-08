-- Restore the code-generating triggers.
--
-- Creating a campaign failed with "null value in column campaign_code violates
-- not-null constraint". campaign_code is NOT NULL and nothing supplies it: the
-- value comes from a BEFORE INSERT trigger that schema.sql declares but the
-- running database did not have. Seven sibling tables carry the same pattern —
-- farmers, procurement orders, vehicles, drivers, dispatch manifests, PoDs and
-- reconciliations — and any of them would fail the same way, so all eight are
-- restored here rather than waiting to meet each one in turn.
--
-- Every statement is idempotent: the functions are CREATE OR REPLACE and each
-- trigger is dropped before being recreated, so this is a no-op where the
-- trigger already exists and correct where it does not.

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

CREATE OR REPLACE FUNCTION generate_order_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.order_code := 'PO-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_order_code ON procurement_orders;
CREATE TRIGGER set_order_code BEFORE INSERT ON procurement_orders FOR EACH ROW
  WHEN (new.order_code IS NULL OR new.order_code = '') EXECUTE FUNCTION generate_order_code();

CREATE OR REPLACE FUNCTION generate_campaign_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.campaign_code := 'CAM-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_campaign_code ON campaigns;
CREATE TRIGGER set_campaign_code BEFORE INSERT ON campaigns FOR EACH ROW
  WHEN (new.campaign_code IS NULL OR new.campaign_code = '') EXECUTE FUNCTION generate_campaign_code();

CREATE OR REPLACE FUNCTION generate_vehicle_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.vehicle_code := 'VEH-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_vehicle_code ON vehicles;
CREATE TRIGGER set_vehicle_code BEFORE INSERT ON vehicles FOR EACH ROW
  WHEN (new.vehicle_code IS NULL OR new.vehicle_code = '') EXECUTE FUNCTION generate_vehicle_code();

CREATE OR REPLACE FUNCTION generate_driver_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.driver_code := 'DRV-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_driver_code ON drivers;
CREATE TRIGGER set_driver_code BEFORE INSERT ON drivers FOR EACH ROW
  WHEN (new.driver_code IS NULL OR new.driver_code = '') EXECUTE FUNCTION generate_driver_code();

CREATE OR REPLACE FUNCTION generate_manifest_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.manifest_code := 'MAN-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_manifest_code ON dispatches;
CREATE TRIGGER set_manifest_code BEFORE INSERT ON dispatches FOR EACH ROW
  WHEN (new.manifest_code IS NULL OR new.manifest_code = '') EXECUTE FUNCTION generate_manifest_code();

CREATE OR REPLACE FUNCTION generate_pod_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.pod_code := 'POD-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_pod_code ON pod;
CREATE TRIGGER set_pod_code BEFORE INSERT ON pod FOR EACH ROW
  WHEN (new.pod_code IS NULL OR new.pod_code = '') EXECUTE FUNCTION generate_pod_code();

CREATE OR REPLACE FUNCTION generate_recon_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN new.reconciliation_code := 'REC-' || UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6)); RETURN new; END; $$;
DROP TRIGGER IF EXISTS set_recon_code ON reconciliations;
CREATE TRIGGER set_recon_code BEFORE INSERT ON reconciliations FOR EACH ROW
  WHEN (new.reconciliation_code IS NULL OR new.reconciliation_code = '') EXECUTE FUNCTION generate_recon_code();
