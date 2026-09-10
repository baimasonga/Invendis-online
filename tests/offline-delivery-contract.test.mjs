import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("migration secures offline proof and arrival evidence tables", () => {
  const sql = read("supabase/migrations/20260910120000_offline_delivery_verification.sql");
  assert.match(sql, /ALTER TABLE public\.pod_verification_proofs ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.dispatch_arrival_evidence/i);
  assert.match(sql, /ALTER TABLE public\.dispatch_arrival_evidence ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON public\.dispatch_arrival_evidence FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /beneficiary_verification_method/i);
  assert.match(sql, /sync_verification_status/i);
  assert.match(sql, /issue_offline_verification_proofs/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.issue_offline_verification_proofs/i);
});

test("server and mobile expose the offline-first contract", () => {
  const route = read("artifacts/api-server/src/routes/offline-delivery.ts");
  const mobile = read("artifacts/field-app/app/confirm-pod.tsx");
  const queue = read("artifacts/field-app/context/OfflineQueueContext.tsx");
  assert.match(route, /offline-credentials\/issue/);
  assert.match(route, /offline-pack/);
  assert.match(route, /arrival-evidence/);
  assert.match(route, /precise distribution-site coordinate is required/);
  assert.match(mobile, /Offline beneficiary verification/);
  assert.match(mobile, /No cellular coverage is required/);
  assert.match(queue, /arrivalEvidencePayload/);
  assert.match(queue, /prepareQueuedPodMedia/);
  assert.match(mobile, /pendingFacePhotoUri/);
});
