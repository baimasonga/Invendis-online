import assert from "node:assert/strict";
import test from "node:test";
import { assessVehicleGpsMatch } from "../artifacts/api-server/src/lib/pod-gps.ts";

const base = {
  mobile: { lat: 8.4657, lng: -13.2317 },
  vehicleRecordedAt: "2026-09-05T10:00:00.000Z",
  matchRadiusM: 500,
  nearRadiusM: 2000,
  maxVehicleAgeMinutes: 30,
  nowMs: Date.parse("2026-09-05T10:10:00.000Z"),
};

test("vehicle and mobile GPS are classified without blocking missing legacy evidence", () => {
  assert.equal(assessVehicleGpsMatch({ ...base, vehicle: { lat: 8.466, lng: -13.232 } }).status, "Matched");
  assert.equal(assessVehicleGpsMatch({ ...base, vehicle: { lat: 8.475, lng: -13.2317 } }).status, "NearMatch");
  assert.equal(assessVehicleGpsMatch({ ...base, vehicle: { lat: 8.50, lng: -13.2317 } }).status, "Mismatch");
  assert.equal(assessVehicleGpsMatch({ ...base, vehicle: { lat: null, lng: null } }).status, "NoVehicleLocation");
  assert.equal(assessVehicleGpsMatch({ ...base, mobile: { lat: null, lng: null }, vehicle: { lat: 8.466, lng: -13.232 } }).status, "NoMobileLocation");
});

test("an old or undated tracker fix cannot be presented as a delivery match", () => {
  assert.equal(assessVehicleGpsMatch({ ...base, vehicleRecordedAt: "2026-09-05T09:00:00.000Z", vehicle: { lat: 8.466, lng: -13.232 } }).status, "StaleVehicleLocation");
  assert.equal(assessVehicleGpsMatch({ ...base, vehicleRecordedAt: null, vehicle: { lat: 8.466, lng: -13.232 } }).status, "StaleVehicleLocation");
});

test("a tracker point after mobile capture is aged by absolute time difference", () => {
  const result = assessVehicleGpsMatch({
    ...base,
    vehicleRecordedAt: "2026-09-05T10:50:00.000Z",
    vehicle: { lat: 8.466, lng: -13.232 },
  });
  assert.equal(result.status, "StaleVehicleLocation");
  assert.equal(result.vehicleAgeSeconds, 2400);
});
