import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [gpsRoute, gpsPage] = await Promise.all([
  read("artifacts/api-server/src/routes/gps.ts"),
  read("artifacts/web-portal/src/pages/gps-tracking.tsx"),
]);

test("GPS managers receive the complete registered fleet", () => {
  assert.match(gpsRoute, /const vehiclesRes = \{ data: visibleVehicles \}/);
  assert.doesNotMatch(gpsRoute, /const trackedVehicles = visibleVehicles\.filter/);
});

test("GPS tracking surfaces unconfigured and idle vehicles by default", () => {
  assert.match(gpsPage, /setup_required/);
  assert.match(gpsPage, /label="Tracker setup required"/);
  assert.match(gpsPage, /const \[showIdle, setShowIdle\] = useState\(true\)/);
});
