import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOCATION_BASES,
  DELIVERABLE_ALLOCATION_STATUSES,
  classifyDuplicateDelivery,
  computeEntitlement,
  entitlementText,
  normaliseBasis,
  type EntitlementLine,
} from "../artifacts/api-server/src/lib/entitlement-rules.ts";

const line = (over: Partial<EntitlementLine> = {}): EntitlementLine => ({
  inputItemId: 1,
  name: "Hoe",
  itemCode: "T-HOE",
  unit: "piece",
  basis: "per_member",
  rate: 1,
  quantityEntitled: 20,
  quantityDelivered: 0,
  isOverridden: false,
  provisional: false,
  ...over,
});

test("a rate is read against its basis", () => {
  assert.equal(computeEntitlement("per_beneficiary", 1, "group", 20, 4), 1);
  assert.equal(computeEntitlement("per_member", 1, "group", 20, 4), 20);
  assert.equal(computeEntitlement("per_member", 1, "individual", null, 4), 1);
  assert.equal(computeEntitlement("per_hectare", 2, "group", 20, 4), 8);
});

test("an entitlement that cannot be computed is null, never zero", () => {
  // Silently allocating zero is how a group ends up with no stock reserved.
  assert.equal(computeEntitlement("per_member", 1, "group", null, 4), null);
  assert.equal(computeEntitlement("per_member", 1, "group", 0, 4), null);
  assert.equal(computeEntitlement("per_hectare", 2, "group", 20, null), null);
  assert.equal(computeEntitlement("per_hectare", 2, "group", 20, 0), null);
  assert.equal(computeEntitlement("per_beneficiary", 0, "group", 20, 4), null);
  assert.equal(computeEntitlement("nonsense", 1, "group", 20, 4), null);
});

test("a group member count only applies to groups", () => {
  // group_size can be left on a record that was later switched to individual.
  assert.equal(computeEntitlement("per_member", 3, "individual", 20, 1), 3);
});

test("basis input is validated, not coerced", () => {
  assert.equal(normaliseBasis(undefined), "per_beneficiary");
  assert.equal(normaliseBasis(""), "per_beneficiary");
  assert.equal(normaliseBasis("Per Member"), "per_member");
  assert.equal(normaliseBasis("per-hectare"), "per_hectare");
  assert.equal(normaliseBasis("per_household"), null);
  assert.equal(normaliseBasis(7), null);
  for (const basis of ALLOCATION_BASES) assert.equal(normaliseBasis(basis), basis);
});

test("the SMS quotes entitled quantities with units", () => {
  assert.equal(
    entitlementText([
      line({ name: "Hoe", quantityEntitled: 20, unit: "piece" }),
      line({ name: "NPK", quantityEntitled: 8, unit: "bag" }),
    ]),
    "Hoe 20 piece, NPK 8 bag",
  );
  assert.equal(entitlementText([line({ name: null })]), "");
  assert.equal(entitlementText([]), "");
});

test("a partially delivered allocation may still receive a delivery", () => {
  // Both the PoD submission guard and the OTP check filter on this list; if it
  // omits Partially Delivered the balance delivery is rejected before it
  // reaches the database.
  assert.ok(DELIVERABLE_ALLOCATION_STATUSES.includes("Partially Delivered"));
  assert.ok(DELIVERABLE_ALLOCATION_STATUSES.includes("Pending"));
  assert.ok(!(DELIVERABLE_ALLOCATION_STATUSES as readonly string[]).includes("Delivered"));
  assert.ok(!(DELIVERABLE_ALLOCATION_STATUSES as readonly string[]).includes("Cancelled"));
});

test("a follow-up delivery is not a duplicate where entitlements are tracked", () => {
  // The earlier Verified PoD is the first half of a split delivery. Flagging
  // the balance would make it unapprovable and strand the allocation.
  assert.equal(
    classifyDuplicateDelivery({ entitlementTracked: true, hasOtherActivePod: true }),
    false,
  );
  assert.equal(
    classifyDuplicateDelivery({ entitlementTracked: true, hasOtherActivePod: false }),
    false,
  );
});

test("the historical duplicate rule still applies without entitlement lines", () => {
  assert.equal(
    classifyDuplicateDelivery({ entitlementTracked: false, hasOtherActivePod: true }),
    true,
  );
  assert.equal(
    classifyDuplicateDelivery({ entitlementTracked: false, hasOtherActivePod: false }),
    false,
  );
});
