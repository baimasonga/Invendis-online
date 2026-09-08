import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HEADER_ALIASES,
  describeScannedHeaders,
  findHeaderRow,
  headerIndex,
  headerIndexContaining,
  normaliseHeader,
} from "../artifacts/web-portal/src/lib/manifest-headers.ts";

test("headers are normalised before comparison", () => {
  // Every one of these came out of a real spreadsheet at some point and would
  // have failed an exact === "community" match.
  for (const raw of [
    "Community", "community", "COMMUNITY", " Community ", "Community ",
    "Community:", "Community.", "Community\n", "Community  Name".replace("  ", " "),
  ]) {
    assert.equal(
      headerIndex(["No", "District", raw], HEADER_ALIASES.community) >= 0,
      true,
      `"${raw}" should match`,
    );
  }
});

test("a non-breaking space does not break matching", () => {
  // Pasting from Word or a PDF leaves U+00A0 behind, which looks identical.
  assert.equal(normaliseHeader("Community "), "community");
  assert.equal(headerIndex(["Community "], HEADER_ALIASES.community), 0);
});

test("the beneficiary column is recognised under its common names", () => {
  for (const name of ["Village", "Town", "Settlement", "Farmer Group", "Community/Village"]) {
    assert.ok(
      headerIndex([name], HEADER_ALIASES.community) >= 0,
      `${name} should be accepted as the beneficiary column`,
    );
  }
});

test("a header buried under a title block is still found", () => {
  // The old scan stopped at row 10, so a plan with a long preamble failed.
  const rows: unknown[][] = [];
  for (let i = 0; i < 14; i++) rows.push(["AVDP DISTRIBUTION PLAN 2026", null, null]);
  rows.push(["No", "District", "Chiefdom", "Community", "Hoe"]);
  assert.equal(findHeaderRow(rows), 14);
});

test("a file with no beneficiary column is reported, not guessed at", () => {
  const rows: unknown[][] = [["No", "District", "Chiefdom", "Beneficiaries", "Hoe"]];
  assert.equal(findHeaderRow(rows), -1);
  const described = describeScannedHeaders(rows);
  // The message has to name what the file does contain, or the user is stuck.
  assert.match(described, /Beneficiaries/);
  assert.match(described, /District/);
});

test("non-string header cells do not stop the scan", () => {
  // A numeric or date cell in the header row used to be skipped outright.
  assert.equal(findHeaderRow([[1, new Date(0), "Community"]]), 0);
});

test("numbers and blanks never match a column", () => {
  assert.equal(headerIndex([null, undefined, "", 0, 42], HEADER_ALIASES.community), -1);
  assert.equal(normaliseHeader(null), "");
  assert.equal(normaliseHeader(undefined), "");
});

test("contact person is matched on a substring, phone on the whole cell", () => {
  assert.equal(headerIndexContaining(["Contact Person Name"], "contact person"), 0);
  assert.equal(headerIndex(["Contact #"], HEADER_ALIASES.contactPhone), 0);
  assert.equal(headerIndex(["Contact Number"], HEADER_ALIASES.contactPhone), 0);
  // "Contact Person" must not be mistaken for the phone column.
  assert.equal(headerIndex(["Contact Person"], HEADER_ALIASES.contactPhone), -1);
});

test("the row-number column is recognised so it is not treated as an item", () => {
  for (const name of ["No", "No.", "S/N", "#", "Serial"]) {
    assert.ok(headerIndex([name], HEADER_ALIASES.rowNumber) >= 0, `${name} should be the row number`);
  }
});
