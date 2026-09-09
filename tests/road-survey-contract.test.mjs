import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, api, page, workspace] = await Promise.all([
  read("supabase/migrations/20260910000000_road_survey_phase_one.sql"),
  read("artifacts/api-server/src/routes/gis.ts"),
  read("artifacts/web-portal/src/pages/road-mapping.tsx"),
  read("artifacts/web-portal/src/components/RoadSurveyWorkspace.tsx"),
]);

test("road survey tables are RLS protected and mutated through the service API", () => {
  for (const table of ["roads", "road_surveys", "road_survey_observations"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
  }
  assert.match(migration, /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT ALL[\s\S]*TO service_role/i);
  assert.match(migration, /ended_at <= started_at \+ interval '72 hours'/i);
  assert.match(migration, /road_surveys_unique_tracker_window_idx/i);
  assert.match(migration, /status <> 'Approved'[\s\S]*accepted_point_count >= 2/i);
});

test("tracker reads are paged and survey geometry is segmented", () => {
  assert.match(api, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.match(api, /processSurveyTrack/);
  assert.match(api, /segments: processed\.segments\.map/);
  assert.match(api, /survey\.status === "Approved" && !current\.latestApprovedAt/);
  assert.match(api, /Only a processed survey awaiting review/);
  assert.match(api, /\.eq\("status", "Ready for Review"\)\.select\(\)\.single\(\)/);
});

test("road surveys are the default and tracker history is labelled unverified", () => {
  assert.match(page, /useState<"surveys" \| "history">\("surveys"\)/);
  assert.match(page, /Tracker History — Unverified/);
  assert.match(workspace, /Only approved survey sessions contribute to official surveyed kilometres/);
  assert.match(workspace, /Disconnected GPS sections are never joined by straight lines/);
});
