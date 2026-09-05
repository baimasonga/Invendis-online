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
const correctiveMigration = await readFile(
  new URL(
    "../supabase/migrations/20260905005200_close_campaign_security_bypasses.sql",
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

test("campaign correction preserves exhaustion markers and serializes dispatch starts", () => {
  assert.doesNotMatch(
    migration,
    /DELETE FROM public\.campaign_stock_reservations WHERE campaign_id=NEW\.campaign_id AND reserved_quantity<=0/i,
  );
  assert.match(correctiveMigration, /ORDER BY r\.input_item_id\s+FOR UPDATE/i);
  assert.match(correctiveMigration, /sum\(di\.quantity_loaded\)/i);
  assert.match(
    correctiveMigration,
    /r\.id IS NULL OR di\.quantity_loaded>r\.reserved_quantity/i,
  );
});

test("campaign correction scopes reads and disables the legacy manifest RPC", () => {
  assert.match(correctiveMigration, /invendis_can_read_campaign/i);
  assert.match(
    correctiveMigration,
    /p\.district_id IS NOT NULL AND c\.district_id = p\.district_id/i,
  );
  assert.match(
    correctiveMigration,
    /tablename = ANY \(ARRAY\['campaigns','campaign_items','allocations'\]\)/i,
  );
  assert.match(correctiveMigration, /import_campaign_manifest_atomic/i);
  assert.match(
    correctiveMigration,
    /REVOKE ALL ON FUNCTION public\.import_manifest_atomic\(jsonb,integer\)[\s\S]*service_role/i,
  );
  assert.match(
    correctiveMigration,
    /Every manifest community must be an approved farmer group already allocated/i,
  );
});
