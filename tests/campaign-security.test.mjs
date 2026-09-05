import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260905005100_harden_campaign_workflow.sql",
    import.meta.url,
  ),
  "utf8",
);

test("campaign migration enforces uniqueness, lifecycle, stock reservations and API-only writes", () => {
  assert.match(migration, /allocations_campaign_farmer_unique/i);
  assert.match(migration, /campaign_items_campaign_input_unique/i);
  assert.match(migration, /transition_campaign_atomic/i);
  assert.match(migration, /campaign_stock_reservations/i);
  assert.match(migration, /enforce_campaign_dispatch_integrity/i);
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE ON public\.campaigns, public\.campaign_items, public\.allocations FROM authenticated/i,
  );
});
