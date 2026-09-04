import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const port = 56000 + (process.pid % 500);
let directory;
let postgres;

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function psql(sql) {
  return run("psql", ["-h", directory, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], sql);
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-h", directory, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"]);
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || stdout)));
    child.stdin.end(sql);
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function startDatabase() {
  directory = await mkdtemp(join(tmpdir(), "pod-security-pg-"));
  run("initdb", ["-D", directory, "--no-locale", "-A", "trust", "-U", "postgres"]);
  postgres = spawn("postgres", ["-D", directory, "-k", directory, "-p", String(port)], { stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      psql("SELECT 1");
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error("Disposable PostgreSQL did not start");
}

async function stopDatabase() {
  if (postgres && postgres.exitCode === null) {
    // postgres forks auxiliary workers; pg_ctl waits for all of them rather
    // than leaving a temporary cluster or open handles in node:test.
    try {
      run("pg_ctl", ["-D", directory, "-m", "immediate", "stop"]);
    } catch {
      postgres.kill("SIGKILL");
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}

async function installSchema() {
  psql(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE farmers (id integer PRIMARY KEY);
    CREATE TABLE dispatches (id integer PRIMARY KEY, campaign_id integer, status text);
    CREATE TABLE dispatch_items (
      id serial PRIMARY KEY, dispatch_id integer, input_item_id integer,
      quantity_loaded double precision NOT NULL DEFAULT 100, quantity_delivered double precision NOT NULL DEFAULT 0
    );
    CREATE TABLE users (id integer PRIMARY KEY, is_active boolean, role text);
    CREATE TABLE pod (
      id serial PRIMARY KEY, dispatch_id integer, campaign_id integer, farmer_id integer,
      input_item_id integer, input_barcode text, quantity_delivered double precision,
      farmer_latitude double precision, farmer_longitude double precision, face_status text,
      notes text, override_reason text, otp_status text, otp_verified boolean, pod_code text,
      status text, gps_status text, submitted_at timestamptz, field_officer_id integer,
      photo_keys jsonb, photo_gps_coords jsonb, vehicle_gps_snapshot jsonb, face_photo_key text,
      face_similarity double precision, otp_code text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE pod_items (id serial PRIMARY KEY, pod_id integer, input_item_id integer, quantity_delivered double precision);
    CREATE FUNCTION approve_pods_atomic(p_pod_ids jsonb, p_approved_by integer)
    RETURNS integer LANGUAGE sql AS $$ SELECT jsonb_array_length(p_pod_ids) $$;
  `);
  run("psql", ["-h", directory, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f",
    resolve(root, "supabase/migrations/20260905004200_pod_submission_idempotency_and_approver_security.sql")]);
  run("psql", ["-h", directory, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f",
    resolve(root, "supabase/migrations/20260905004300_serialize_idempotent_pod_submissions.sql")]);
  psql(`
    INSERT INTO farmers VALUES (1), (2), (3), (4), (5);
    INSERT INTO dispatches VALUES (1, 10, 'Arrived'), (2, 10, 'Arrived');
    INSERT INTO dispatch_items(dispatch_id,input_item_id) VALUES (1, 1), (2, 1);
    INSERT INTO users VALUES (99, true, 'Admin'), (98, true, 'FieldOfficer'), (97, false, 'Admin');
  `);
}

test("PoD migrations enforce proof lifecycle, concurrent idempotency, and duplicate rejection", async (t) => {
  await startDatabase();
  t.after(stopDatabase);
  await installSchema();

  const proof = "proof-valid-for-offline";
  // Deliberately set this close to the seven-day limit: it is still usable.
  psql(`INSERT INTO pod_verification_proofs(token_hash,kind,farmer_id,dispatch_id,status,expires_at)
        VALUES ('${sha256(proof)}','otp',1,1,'Verified',now() + interval '6 days 23 hours 59 minutes')`);
  const record = JSON.stringify({
    submission_key: "retry-key", dispatch_id: 1, campaign_id: 10, farmer_id: 1,
    input_item_id: 1, quantity_delivered: 1, pod_code: "POD-ONE", status: "Pending",
    gps_status: "Pending", otp_verification_hash: sha256(proof),
  }).replaceAll("'", "''");
  const items = JSON.stringify([{ input_item_id: 1, quantity_delivered: 1 }]).replaceAll("'", "''");
  const firstId = Number(psql(`SELECT (submit_pod_atomic('${record}'::jsonb, '${items}'::jsonb)->>'id')::integer`));
  assert.ok(firstId > 0);
  assert.equal(psql(`SELECT consumed_at IS NOT NULL FROM pod_verification_proofs WHERE token_hash='${sha256(proof)}'`), "t");

  // The same key must return before validating the now-consumed proof.
  const retryId = Number(psql(`SELECT (submit_pod_atomic('${record}'::jsonb, '${items}'::jsonb)->>'id')::integer`));
  assert.equal(retryId, firstId);
  assert.throws(() => psql(`SELECT submit_pod_atomic('${record.replace("retry-key", "replay-key")}'::jsonb, '${items}'::jsonb)`), /already used OTP verification proof/);

  const expiredProof = "expired-otp-proof";
  psql(`INSERT INTO pod_verification_proofs(token_hash,kind,farmer_id,dispatch_id,status,expires_at)
        VALUES ('${sha256(expiredProof)}','otp',5,1,'Verified',now() - interval '1 second')`);
  const expiredRecord = record.replace(sha256(proof), sha256(expiredProof)).replace('"farmer_id":1', '"farmer_id":5').replace("retry-key", "expired-key");
  assert.throws(() => psql(`SELECT submit_pod_atomic('${expiredRecord}'::jsonb, '${items}'::jsonb)`), /invalid, expired, or already used OTP verification proof/);

  // Keep the first transaction open after submission. A second same-key
  // request must wait for the key lock, then return the inserted row rather
  // than failing because the verification proof was consumed meanwhile.
  const concurrentProof = "concurrent-proof";
  psql(`INSERT INTO pod_verification_proofs(token_hash,kind,farmer_id,dispatch_id,status,expires_at)
        VALUES ('${sha256(concurrentProof)}','otp',2,1,'Verified',now() + interval '7 days')`);
  const concurrentRecord = record
    .replace(sha256(proof), sha256(concurrentProof))
    .replace('"farmer_id":1', '"farmer_id":2')
    .replace("retry-key", "concurrent-key")
    .replace("POD-ONE", "POD-TWO");
  const firstConcurrent = psqlAsync(`BEGIN; SELECT (submit_pod_atomic('${concurrentRecord}'::jsonb, '${items}'::jsonb)->>'id')::integer; SELECT pg_sleep(0.25); COMMIT;`);
  await new Promise(resolve => setTimeout(resolve, 40));
  const secondConcurrent = psqlAsync(`SELECT (submit_pod_atomic('${concurrentRecord}'::jsonb, '${items}'::jsonb)->>'id')::integer;`);
  const [firstConcurrentOutput, secondConcurrentOutput] = await Promise.all([firstConcurrent, secondConcurrent]);
  const concurrentId = Number(firstConcurrentOutput.split("\n")[0]);
  assert.equal(Number(secondConcurrentOutput), concurrentId);

  const faceProof = "face-proof";
  psql(`INSERT INTO pod_verification_proofs(token_hash,kind,farmer_id,dispatch_id,status,expires_at)
        VALUES ('${sha256(faceProof)}','face',3,1,'Verified',now() + interval '7 days')`);
  const faceRecord = record
    .replace('"farmer_id":1', '"farmer_id":3')
    .replace("retry-key", "face-key")
    .replace("POD-ONE", "POD-FACE")
    .replace(`"otp_verification_hash":"${sha256(proof)}"`, `"face_verification_hash":"${sha256(faceProof)}"`);
  const faceId = Number(psql(`SELECT (submit_pod_atomic('${faceRecord}'::jsonb, '${items}'::jsonb)->>'id')::integer`));
  assert.ok(faceId > 0);
  assert.equal(psql(`SELECT consumed_at IS NOT NULL FROM pod_verification_proofs WHERE token_hash='${sha256(faceProof)}'`), "t");
  assert.equal(Number(psql(`SELECT (submit_pod_atomic('${faceRecord}'::jsonb, '${items}'::jsonb)->>'id')::integer`)), faceId);
  assert.throws(() => psql(`SELECT submit_pod_atomic('${faceRecord.replace("face-key", "face-replay")}'::jsonb, '${items}'::jsonb)`), /already used face verification proof/);
  assert.throws(() => psql(`SELECT submit_pod_atomic('${faceRecord.replace('"farmer_id":3', '"farmer_id":4').replace("face-key", "face-farmer-mismatch")}'::jsonb, '${items}'::jsonb)`), /invalid, expired, or already used face verification proof/);
  assert.throws(() => psql(`SELECT submit_pod_atomic('${faceRecord.replace('"dispatch_id":1', '"dispatch_id":2').replace("face-key", "face-dispatch-mismatch")}'::jsonb, '${items}'::jsonb)`), /invalid, expired, or already used face verification proof/);

  const mismatchProof = "farmer-bound-proof";
  psql(`INSERT INTO pod_verification_proofs(token_hash,kind,farmer_id,dispatch_id,status,expires_at)
        VALUES ('${sha256(mismatchProof)}','otp',1,1,'Verified',now() + interval '7 days')`);
  const farmerMismatch = record.replace(sha256(proof), sha256(mismatchProof)).replace('"farmer_id":1', '"farmer_id":2').replace("retry-key", "farmer-mismatch");
  assert.throws(() => psql(`SELECT submit_pod_atomic('${farmerMismatch}'::jsonb, '${items}'::jsonb)`), /invalid, expired, or already used OTP verification proof/);
  const dispatchMismatch = record.replace(sha256(proof), sha256(mismatchProof)).replace('"dispatch_id":1', '"dispatch_id":2').replace("retry-key", "dispatch-mismatch");
  assert.throws(() => psql(`SELECT submit_pod_atomic('${dispatchMismatch}'::jsonb, '${items}'::jsonb)`), /invalid, expired, or already used OTP verification proof/);

  psql(`INSERT INTO pod(dispatch_id,campaign_id,farmer_id,status,duplicate_flag) VALUES
    (1,10,2,'Pending',true), (1,10,2,'Pending',true)`);
  const duplicateIds = psql("SELECT string_agg(id::text, ',' ORDER BY id) FROM pod WHERE duplicate_flag").split(",");
  assert.throws(() => psql(`SELECT approve_pods_atomic(jsonb_build_array(${duplicateIds[0]}), 97)`), /approved_by must be an active operational user/);
  assert.throws(() => psql(`SELECT approve_pods_atomic(jsonb_build_array(${duplicateIds.join(",")}), 98)`), /approved_by must be an active operational user/);
  assert.throws(() => psql(`SELECT approve_pods_atomic(jsonb_build_array(${duplicateIds[0]}), 99)`), /duplicate-flagged PoDs cannot be approved/);
  assert.throws(() => psql(`SELECT approve_pods_atomic(jsonb_build_array(${duplicateIds.join(",")}), 99)`), /duplicate-flagged PoDs cannot be approved/);
});