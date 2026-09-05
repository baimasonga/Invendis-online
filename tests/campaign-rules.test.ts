import assert from "node:assert/strict";
import test from "node:test";
import {
  canDispatchCampaign,
  canEditCampaign,
  validateCampaignInput,
} from "../artifacts/api-server/src/lib/campaign-rules.ts";

const valid = {
  name: "2026 Rice Inputs",
  season: "2026 Rainy Season",
  districtId: 1,
  valueChainId: 2,
  distributionSiteId: 3,
  sourceWarehouseId: 4,
  startDate: "2026-09-01",
  endDate: "2026-12-31",
  totalFarmers: 100,
};

test("campaign input requires a complete operational destination and source", () => {
  assert.deepEqual(validateCampaignInput(valid), []);
  assert.match(
    validateCampaignInput({ ...valid, distributionSiteId: null }).join(" "),
    /Distribution site/,
  );
  assert.match(
    validateCampaignInput({ ...valid, sourceWarehouseId: null }).join(" "),
    /Source warehouse/,
  );
  assert.match(
    validateCampaignInput({ ...valid, endDate: "2026-08-31" }).join(" "),
    /before start/,
  );
});

test("campaign edit and dispatch states are explicit", () => {
  assert.equal(canEditCampaign("Draft"), true);
  assert.equal(canEditCampaign("Rejected"), true);
  assert.equal(canEditCampaign("Submitted"), false);
  assert.equal(canDispatchCampaign("Approved"), true);
  assert.equal(canDispatchCampaign("Active"), true);
  assert.equal(canDispatchCampaign("Draft"), false);
});
