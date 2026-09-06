import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [
  deliveryGuard,
  farmerRoute,
  mobilePod,
  mobileLookup,
  gpsRoute,
  migration,
  androidWorkflow,
] = await Promise.all([
  read("artifacts/api-server/src/routes/delivery-guard.ts"),
  read("artifacts/api-server/src/routes/delivery-farmers.ts"),
  read("artifacts/field-app/app/confirm-pod.tsx"),
  read("artifacts/field-app/app/scan-farmer.tsx"),
  read("artifacts/api-server/src/routes/gps.ts"),
  read(
    "supabase/migrations/20260905005300_harden_mobile_delivery_contract.sql",
  ),
  read(".github/workflows/build-android.yml"),
]);

test("field delivery lookup is scoped to an authorized dispatch campaign", () => {
  assert.match(farmerRoute, /\/api\/dispatch\/:dispatchId\/farmers/);
  assert.match(farmerRoute, /canReadDispatch/);
  assert.match(
    farmerRoute,
    /\.eq\("campaign_id", \(dispatch as any\)\.campaign_id\)/,
  );
  assert.match(mobileLookup, /farmerByBarcodeForDispatch/);
  assert.match(mobileLookup, /searchFarmersForDispatch/);
});

test("mobile PoD evidence cannot be queued before verification", () => {
  assert.match(deliveryGuard, /photoKeys\.length < 2/);
  assert.match(deliveryGuard, /!otpToken \|\| !faceToken/);
  assert.equal(
    (mobilePod.match(/Save Offline/g) ?? []).length,
    1,
    "only the failed final-submit fallback may queue a PoD",
  );
  assert.match(mobilePod, /\.filter\(p => p\.key\)\s*\.map\(p => p\.gps/);
});

test("vehicle corroboration uses hardware GPS from the same dispatch", () => {
  assert.match(migration, /NEW\.dispatch_id/);
  assert.match(migration, /source = 'hardware'/);
  assert.match(gpsRoute, /source:\s+"mobile"/);
  assert.match(gpsRoute, /source:\s+"hardware"/);
  assert.match(migration, /classify_linked_hardware_gps_track/);
  assert.match(migration, /gps_track_dispatch_vehicle_hardware_recorded_idx/);
});

test("API contract changes trigger the Android build", () => {
  assert.match(androidWorkflow, /artifacts\/api-server\/src\/routes\/pod\.ts/);
  assert.match(androidWorkflow, /supabase\/migrations\/\*\*/);
});
