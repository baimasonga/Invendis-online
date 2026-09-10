import assert from "node:assert/strict";
import test from "node:test";
import {
  assessArrivalEvidence,
  createOfflineVoucher,
  credentialHash,
  verifyOfflineVoucher,
} from "../artifacts/api-server/src/lib/offline-delivery.ts";
import { matchOfflineCredential, sha256 } from "../artifacts/field-app/lib/offline-delivery.ts";

test("mobile and server credential hashes agree", () => {
  assert.equal(sha256("12345678"), credentialHash("12345678"));
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("signed offline vouchers reject tampering", () => {
  const secret = "a-secure-test-secret-with-at-least-thirty-two-characters";
  const voucher = createOfflineVoucher({
    dispatchId: 7,
    farmerId: 11,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    signingSecret: secret,
  });
  assert.match(voucher, /^AVDP1\./);
  assert.equal(verifyOfflineVoucher(voucher, secret), true);
  assert.equal(verifyOfflineVoucher(voucher + "x", secret), false);
});

test("offline pack credentials are farmer-bound and expiry-aware", () => {
  const raw = "87654321";
  const pack = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    dispatchId: 2,
    vehicleId: 3,
    destination: null,
    arrivalPolicy: { minimumFixes: 3, minimumDwellSeconds: 180, maximumAccuracyM: 50 },
    credentials: [{ farmer_id: 9, token_hash: sha256(raw), method: "offline_pin" as const, expires_at: new Date(Date.now() + 60_000).toISOString() }],
  };
  assert.equal(matchOfflineCredential(pack, 9, raw)?.method, "offline_pin");
  assert.equal(matchOfflineCredential(pack, 10, raw), null);
});

test("arrival requires three accurate in-zone fixes and three minutes dwell", () => {
  const destination = { latitude: 8.46, longitude: -11.78, geofenceRadiusM: 500 };
  const start = Date.parse("2026-09-09T10:00:00Z");
  const fixes = [0, 90, 190].map((seconds) => ({
    latitude: 8.4601,
    longitude: -11.7801,
    accuracy: 12,
    capturedAt: new Date(start + seconds * 1000).toISOString(),
  }));
  assert.equal(assessArrivalEvidence(fixes, destination).status, "GPS Verified");
  assert.equal(assessArrivalEvidence(fixes.slice(0, 2), destination).status, "Needs Review");
  assert.equal(assessArrivalEvidence(fixes.map(f => ({ ...f, accuracy: 80 })), destination).status, "Needs Review");
});
