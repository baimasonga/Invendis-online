import assert from "node:assert/strict";
import test from "node:test";
import { processSurveyTrack } from "../artifacts/api-server/src/lib/road-survey.ts";

const point = (latitude: number, longitude: number, recorded_at: string, speed = 20) => ({
  latitude, longitude, recorded_at, speed, accuracy: 10,
});

test("survey processing splits signal gaps instead of drawing false connecting lines", () => {
  const result = processSurveyTrack([
    point(8.45, -11.70, "2026-09-09T08:00:00Z"),
    point(8.451, -11.699, "2026-09-09T08:01:00Z"),
    point(8.60, -11.50, "2026-09-09T09:00:00Z"),
    point(8.601, -11.499, "2026-09-09T09:01:00Z"),
  ]);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.gapCount, 1);
  assert.equal(result.acceptedPointCount, 4);
  assert.ok(result.distanceKm < 1, "the hour-long gap must not contribute a diagonal distance");
});

test("survey processing excludes stationary noise and impossible jumps", () => {
  const result = processSurveyTrack([
    point(8.45, -11.70, "2026-09-09T08:00:00Z"),
    point(8.45, -11.70, "2026-09-09T08:00:30Z", 0),
    point(9.45, -10.70, "2026-09-09T08:01:00Z", 200),
    point(8.451, -11.699, "2026-09-09T08:02:00Z"),
  ]);
  assert.equal(result.segmentCount, 1);
  assert.equal(result.acceptedPointCount, 2);
  assert.equal(result.discardedPointCount, 2);
  assert.ok(result.distanceKm > 0 && result.distanceKm < 1);
});

test("an empty or one-point survey is insufficient", () => {
  assert.equal(processSurveyTrack([]).qualityStatus, "Insufficient");
  assert.equal(processSurveyTrack([point(8.45, -11.70, "2026-09-09T08:00:00Z")]).qualityStatus, "Insufficient");
});
