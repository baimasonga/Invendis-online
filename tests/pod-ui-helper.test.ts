import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationProofPayload,
  saveFirstReferenceIfNeeded,
} from "../artifacts/field-app/lib/pod-proof.ts";
import { buildWebPodProofPayload } from "../artifacts/web-portal/src/lib/pod-proof-payload.ts";
import { isDispatchInScope, isFarmerInCampaignScope } from "../artifacts/api-server/src/lib/dispatch-scope.ts";

test("field PoD payload only carries the minted verification proofs", () => {
  assert.deepEqual(buildVerificationProofPayload("otp-proof", "face-proof"), {
    otpVerificationToken: "otp-proof",
    faceVerificationToken: "face-proof",
  });
  assert.deepEqual(buildVerificationProofPayload(null, null), {});
  assert.deepEqual(buildVerificationProofPayload("otp-proof", null), {
    otpVerificationToken: "otp-proof",
  });
});

test("web payload propagates an OTP proof and omits it after reset", () => {
  assert.deepEqual(buildWebPodProofPayload("minted-otp-proof"), { otpVerificationToken: "minted-otp-proof" });
  assert.deepEqual(buildWebPodProofPayload(null), {});
});

test("a field officer saves exactly one dispatch-bound NoReference capture", async () => {
  let calls = 0;
  const save = async () => { calls++; };
  assert.equal(await saveFirstReferenceIfNeeded({
    faceStatus: "NoReference", deliveryKey: "farmers/1/delivery/photo.jpg", dispatchId: "12", saveReference: save,
  }), true);
  assert.equal(calls, 1);
  assert.equal(await saveFirstReferenceIfNeeded({
    faceStatus: "Verified", deliveryKey: "farmers/1/delivery/photo.jpg", dispatchId: "12", saveReference: save,
  }), false);
  assert.equal(await saveFirstReferenceIfNeeded({
    faceStatus: "NoReference", deliveryKey: null, dispatchId: "12", saveReference: save,
  }), false);
  assert.equal(await saveFirstReferenceIfNeeded({
    faceStatus: "NoReference", deliveryKey: "farmers/1/delivery/photo.jpg", dispatchId: undefined, saveReference: save,
  }), false);
  assert.equal(calls, 1);
});

test("district and field-officer scopes cannot mutate another dispatch", () => {
  assert.equal(isDispatchInScope({ unrestricted: false, campaignIds: [10] }, { campaign_id: 10 }), true);
  assert.equal(isDispatchInScope({ unrestricted: false, campaignIds: [10] }, { campaign_id: 11 }), false);
  assert.equal(isDispatchInScope({ unrestricted: false, fieldOfficerId: 7 }, { field_officer_id: 8 }), false);
  assert.equal(isDispatchInScope({ unrestricted: true }, { campaign_id: 11, field_officer_id: 8 }), true);
  assert.equal(isFarmerInCampaignScope({ unrestricted: false, campaignIds: [10] }, [11]), false);
  assert.equal(isFarmerInCampaignScope({ unrestricted: false, campaignIds: [10] }, [10]), true);
  assert.equal(isFarmerInCampaignScope({ unrestricted: false, fieldOfficerId: 7 }, [12], [10]), false);
});