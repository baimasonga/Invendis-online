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
  officerMigration,
  androidWorkflow,
  apiApp,
  replitConfig,
] = await Promise.all([
  read("artifacts/api-server/src/routes/delivery-guard.ts"),
  read("artifacts/api-server/src/routes/delivery-farmers.ts"),
  read("artifacts/field-app/app/confirm-pod.tsx"),
  read("artifacts/field-app/app/scan-farmer.tsx"),
  read("artifacts/api-server/src/routes/gps.ts"),
  read(
    "supabase/migrations/20260905005300_harden_mobile_delivery_contract.sql",
  ),
  read(
    "supabase/migrations/20260908090000_fix_dispatch_field_officer_contract.sql",
  ),
  read(".github/workflows/build-android.yml"),
  read("artifacts/api-server/src/app.ts"),
  read(".replit"),
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

test("mobile PoD evidence is only queued after beneficiary verification", () => {
  assert.match(deliveryGuard, /photoKeys\.length < 2/);
  assert.match(deliveryGuard, /!otpToken \|\| !faceToken/);
  assert.equal(
    (mobilePod.match(/Save Offline/g) ?? []).length,
    2,
    "offline media and failed final-submit paths must be explicit",
  );
  assert.match(mobilePod, /Save Offline — Verify After Sync/);
  assert.match(mobilePod, /pendingFacePhotoUri/);
  assert.match(mobilePod, /pendingPhotos/);
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

test("dispatch ownership remains an integer mobile user contract", () => {
  assert.match(
    officerMigration,
    /ALTER COLUMN field_officer_id TYPE integer/i,
  );
  assert.match(
    officerMigration,
    /FOREIGN KEY \(field_officer_id\) REFERENCES public\.users\(id\)/i,
  );
  assert.match(
    officerMigration,
    /DROP TRIGGER IF EXISTS dispatch_requires_field_officer[\s\S]*CREATE TRIGGER dispatch_requires_field_officer/i,
  );
});

test("Replit serves the portal and API from one production process", () => {
  assert.match(replitConfig, /build = \["pnpm", "run", "build:replit"\]/);
  assert.match(replitConfig, /run = \["pnpm", "run", "start:replit"\]/);
  assert.match(apiApp, /express\.static\(webDistDir\)/);
  assert.match(apiApp, /req\.path\.startsWith\("\/api\/"\)/);
});
