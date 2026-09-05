import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const port = 56500 + (process.pid % 400);
let directory;
let postgres;

function commandExists(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;
}

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function psql(sql) {
  return run(
    "psql",
    [
      "-h",
      directory,
      "-p",
      String(port),
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    sql,
  );
}

async function startDatabase() {
  directory = await mkdtemp(join(tmpdir(), "campaign-security-pg-"));
  run("initdb", [
    "-D",
    directory,
    "--no-locale",
    "-A",
    "trust",
    "-U",
    "postgres",
  ]);
  postgres = spawn(
    "postgres",
    ["-D", directory, "-k", directory, "-p", String(port)],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      psql("SELECT 1");
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error("Disposable PostgreSQL did not start");
}

async function stopDatabase() {
  if (postgres && postgres.exitCode === null) {
    try {
      run("pg_ctl", ["-D", directory, "-m", "immediate", "stop"]);
    } catch {
      postgres.kill("SIGKILL");
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}

function installSchema() {
  psql(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE SCHEMA private;
    CREATE TABLE profiles (id uuid PRIMARY KEY, role text, district_id integer, is_active boolean);
    CREATE TABLE districts (id integer PRIMARY KEY, name text);
    CREATE TABLE warehouses (id integer PRIMARY KEY);
    CREATE TABLE distribution_sites (id integer PRIMARY KEY);
    CREATE TABLE input_items (id integer PRIMARY KEY, name text);
    CREATE TABLE farmers (
      id integer PRIMARY KEY, farmer_group text, status text, district_id integer,
      value_chain_id integer, farmer_code text, barcode_token text
    );
    CREATE TABLE campaigns (
      id integer PRIMARY KEY, name text, district_id integer, value_chain_id integer,
      distribution_site_id integer, source_warehouse_id integer, status text, updated_at timestamptz
    );
    CREATE TABLE campaign_items (
      id integer PRIMARY KEY, campaign_id integer, input_item_id integer,
      quantity_per_farmer double precision
    );
    CREATE TABLE allocations (
      id integer PRIMARY KEY, campaign_id integer, farmer_id integer, status text
    );
    CREATE TABLE campaign_stock_reservations (
      id bigserial PRIMARY KEY, campaign_id integer, warehouse_id integer,
      input_item_id integer, reserved_quantity double precision, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE stock_balance (
      id integer PRIMARY KEY, warehouse_id integer, input_item_id integer,
      available double precision
    );
    CREATE TABLE dispatches (
      id serial PRIMARY KEY, manifest_code text, campaign_id integer, warehouse_id integer,
      vehicle_type text, vehicle_id integer, driver_id integer, hired_plate text,
      hired_driver_name text, field_officer_id integer, notes text, created_by integer,
      total_packages integer, status text DEFAULT 'Draft'
    );
    CREATE TABLE dispatch_items (
      id serial PRIMARY KEY, dispatch_id integer, input_item_id integer,
      quantity_loaded double precision
    );
    CREATE FUNCTION enforce_campaign_dispatch_integrity() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION activate_campaign_on_dispatch() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER dispatch_campaign_integrity
      BEFORE INSERT OR UPDATE OF campaign_id,warehouse_id,status ON dispatches
      FOR EACH ROW EXECUTE FUNCTION enforce_campaign_dispatch_integrity();
    CREATE TRIGGER dispatch_activate_campaign
      AFTER UPDATE OF status ON dispatches
      FOR EACH ROW EXECUTE FUNCTION activate_campaign_on_dispatch();
    CREATE FUNCTION import_manifest_atomic(jsonb,integer) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE campaign_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
    -- Reproduce the live FOR ALL policy that caused the district data leak.
    CREATE POLICY field_operations_write ON allocations
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
    GRANT SELECT ON campaigns,campaign_items,allocations TO authenticated;
  `);
  run("psql", [
    "-h",
    directory,
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    resolve(
      root,
      "supabase/migrations/20260905005200_close_campaign_security_bypasses.sql",
    ),
  ]);
}

test("campaign database blocks exhausted reservations, cross-district reads, and unsafe imports", async (t) => {
  if (!["initdb", "postgres", "psql", "pg_ctl"].every(commandExists)) {
    t.skip("PostgreSQL command-line tools are not installed");
    return;
  }
  await startDatabase();
  t.after(stopDatabase);
  installSchema();

  psql(`
    INSERT INTO districts VALUES (1,'North'),(2,'South');
    INSERT INTO warehouses VALUES (1);
    INSERT INTO distribution_sites VALUES (1);
    INSERT INTO input_items VALUES (1,'Seed');
    INSERT INTO campaigns VALUES
      (10,'North campaign',1,1,1,1,'Approved',now()),
      (11,'South campaign',2,1,1,1,'Approved',now());
    INSERT INTO campaign_items VALUES (10,10,1,10),(11,11,1,10);
    INSERT INTO farmers VALUES (10,'North Group','approved',1,1,'F-10','B-10');
    INSERT INTO allocations VALUES (10,10,10,'Pending'),(11,11,10,'Pending');
    INSERT INTO campaign_stock_reservations(campaign_id,warehouse_id,input_item_id,reserved_quantity)
      VALUES (10,1,1,10);
    INSERT INTO stock_balance VALUES (1,1,1,100);
    INSERT INTO dispatches(id,campaign_id,warehouse_id,status) VALUES (10,10,1,'Draft');
    INSERT INTO dispatch_items(dispatch_id,input_item_id,quantity_loaded) VALUES (10,1,10);
    UPDATE dispatches SET status='In Transit' WHERE id=10;
  `);
  assert.equal(
    psql(
      "SELECT reserved_quantity FROM campaign_stock_reservations WHERE campaign_id=10",
    ),
    "0",
  );

  psql(`
    INSERT INTO dispatches(id,campaign_id,warehouse_id,status) VALUES (11,10,1,'Draft');
    INSERT INTO dispatch_items(dispatch_id,input_item_id,quantity_loaded) VALUES (11,1,1);
  `);
  assert.throws(
    () => psql("UPDATE dispatches SET status='In Transit' WHERE id=11"),
    /exceed the campaign stock reservation/,
  );

  const coordinatorId = "11111111-1111-1111-1111-111111111111";
  psql(
    `INSERT INTO profiles VALUES ('${coordinatorId}','DistrictCoordinator',1,true)`,
  );
  const visible =
    psql(`SET ROLE authenticated; SET request.jwt.claim.sub='${coordinatorId}';
    SELECT (SELECT count(*) FROM campaigns)||','||(SELECT count(*) FROM campaign_items)||','||(SELECT count(*) FROM allocations)`);
  assert.equal(visible, "1,1,1");
  assert.equal(
    psql(
      "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='allocations' AND policyname='field_operations_write'",
    ),
    "0",
  );

  assert.equal(
    psql(
      "SELECT has_function_privilege('service_role','public.import_manifest_atomic(jsonb,integer)','EXECUTE')",
    ),
    "f",
  );

  psql(
    "UPDATE campaign_stock_reservations SET reserved_quantity=20 WHERE campaign_id=10",
  );
  const payload = JSON.stringify({
    campaignId: 10,
    warehouseId: 1,
    vehicleType: "hired",
    hiredPlate: "TEST-1",
    rows: [{ community: "North Group", district: "North", quantities: [5] }],
    columns: [{ colIndex: 0, name: "Seed", unit: "kg", itemId: 1 }],
  }).replaceAll("'", "''");
  const before = psql(
    "SELECT (SELECT count(*) FROM farmers)||','||(SELECT count(*) FROM allocations)||','||(SELECT count(*) FROM input_items)",
  );
  const manifest = psql(
    `SET ROLE service_role; SELECT import_campaign_manifest_atomic('${payload}'::jsonb,1)->>'manifestCode'`,
  );
  assert.match(manifest, /^MAN-/);
  const after = psql(
    "SELECT (SELECT count(*) FROM farmers)||','||(SELECT count(*) FROM allocations)||','||(SELECT count(*) FROM input_items)",
  );
  assert.equal(after, before);

  const unsafePayload = payload.replace('"campaignId":10,', "");
  assert.throws(
    () =>
      psql(
        `SET ROLE service_role; SELECT import_campaign_manifest_atomic('${unsafePayload}'::jsonb,1)`,
      ),
    /Select an existing approved campaign/,
  );
});
