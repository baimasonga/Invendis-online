import { Router } from "express";
import { requireAnyAuth, generateProxyUploadUrl, requireRoleIfJwt } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { getPresignedViewUrl, compareFaces, detectLabels, detectFaces, bucket } from "../lib/aws.js";
import { logAudit } from "../lib/audit.js";
import { canReadDispatch, getDispatchReadScope } from "../lib/dispatch-auth.js";
import { isFarmerInCampaignScope } from "../lib/dispatch-scope.js";
import { createHash, randomBytes } from "crypto";

const router = Router();

const MANAGEMENT_ROLES = ["admin", "projectmanager", "districtcoordinator", "warehousemanager"];
function isManagement(req: import("express").Request): boolean {
  return MANAGEMENT_ROLES.includes((req.user?.role ?? req.supabaseUser?.role ?? "").toLowerCase());
}
function keyForFarmer(key: string, farmerId: number, purposes: string[]): boolean {
  return purposes.some(purpose => key.startsWith(`farmers/${farmerId}/${purpose}/`));
}
async function canAccessFarmer(req: import("express").Request, farmerId: number): Promise<boolean> {
  const scope = await getDispatchReadScope(req);
  if (scope.unrestricted) return !!(await supa.from("farmers").select("id").eq("id", farmerId).maybeSingle()).data;
  let allowedCampaignIds = scope.campaignIds ?? [];
  if (scope.fieldOfficerId !== undefined) {
    const { data: dispatches } = await supa.from("dispatches").select("campaign_id")
      .eq("field_officer_id", scope.fieldOfficerId);
    allowedCampaignIds = (dispatches ?? []).map((d: any) => d.campaign_id).filter(Boolean);
  }
  if (!allowedCampaignIds.length) return false;
  const { data } = await supa.from("allocations").select("campaign_id").eq("farmer_id", farmerId).in("campaign_id", allowedCampaignIds).limit(1);
  return isFarmerInCampaignScope(scope, (data ?? []).map((row: any) => Number(row.campaign_id)), allowedCampaignIds);
}
async function mintFaceProof(farmerId: number, dispatchId: number, status: string, similarity: number | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { error } = await supa.from("pod_verification_proofs").insert({
    token_hash: createHash("sha256").update(token).digest("hex"), kind: "face",
    farmer_id: farmerId, dispatch_id: dispatchId, status, similarity,
    // Proofs are one-use and resource-bound, but must survive an offline queue.
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`Unable to issue face verification proof: ${error.message}`);
  return token;
}

router.post("/api/face/upload-url", requireAnyAuth, async (req, res) => {
  const { farmerId, purpose } = req.body as { farmerId?: number; purpose?: string };

  const safeP = purpose === "reference" ? "reference" : purpose === "identify" ? "identify" : "delivery";
  if ((safeP === "reference" || safeP === "identify") && !isManagement(req)) {
    res.status(403).json({ error: "Forbidden", message: "Management role required for reference or identification photos" });
    return;
  }
  if (safeP === "identify") {
    const scope = await getDispatchReadScope(req);
    if (!scope.unrestricted) {
      res.status(403).json({ error: "Forbidden", message: "Project-wide identification requires a project management role" });
      return;
    }
  }
  if (safeP === "reference" && (!farmerId || !(await canAccessFarmer(req, Number(farmerId))))) {
    res.status(403).json({ error: "Forbidden", message: "You may not upload a reference photo for this farmer" });
    return;
  }
  if (safeP === "delivery" && (!farmerId || !(await canAccessFarmer(req, Number(farmerId))))) {
    res.status(403).json({ error: "Forbidden", message: "You may not upload delivery evidence for this farmer" });
    return;
  }
  const key = farmerId
    ? `farmers/${farmerId}/${safeP}/${Date.now()}.jpg`
    : `identify/${Date.now()}.jpg`;
  try {
    const url = generateProxyUploadUrl(key, req);
    res.json({ uploadUrl: url, key, bucket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/face/view-url", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const { key } = req.query as { key?: string };
  if (!key) { res.status(400).json({ error: "key is required" }); return; }
  const farmerKey = key.match(/^(?:farmers|pods)\/(\d+)\//);
  if (farmerKey) {
    if (!(await canAccessFarmer(req, Number(farmerKey[1])))) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }
  } else {
    const scope = await getDispatchReadScope(req);
    if (!scope.unrestricted) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }
  }
  try {
    const url = await getPresignedViewUrl(key);
    res.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/compare", requireAnyAuth, async (req, res) => {
  const { farmerId, deliveryKey, dispatchId } = req.body as { farmerId?: number; deliveryKey?: string; dispatchId?: number };
  if (!farmerId || !deliveryKey || !dispatchId) {
    res.status(400).json({ error: "farmerId, dispatchId and deliveryKey are required" });
    return;
  }
  if (!(await canAccessFarmer(req, Number(farmerId))) || !keyForFarmer(deliveryKey, Number(farmerId), ["delivery"])) {
    res.status(403).json({ error: "Forbidden", message: "Delivery photo key is not authorized for this farmer" });
    return;
  }
  const { data: dispatch } = await supa.from("dispatches").select("field_officer_id,campaign_id").eq("id", Number(dispatchId)).maybeSingle();
  if (!dispatch || !(await canReadDispatch(req, dispatch as any))) {
    res.status(403).json({ error: "Forbidden", message: "You may not verify this dispatch" });
    return;
  }
  const { data: allocation } = await supa.from("allocations")
    .select("id")
    .eq("campaign_id", (dispatch as any).campaign_id)
    .eq("farmer_id", Number(farmerId))
    .in("status", ["Approved", "Pending"])
    .limit(1)
    .maybeSingle();
  if (!allocation) {
    res.status(403).json({ error: "Forbidden", message: "This farmer is not eligible for the dispatch campaign" });
    return;
  }

  const { data: rows } = await supa.from("farmers").select("photo_url").eq("id", farmerId).limit(1);
  const referenceKey: string | null = (rows?.[0] as any)?.photo_url ?? null;

  if (!referenceKey) {
    const verificationToken = await mintFaceProof(Number(farmerId), Number(dispatchId), "NoReference", null);
    res.json({ matched: false, similarity: null, reason: "no_reference_photo", faceStatus: "NoReference", verificationToken });
    return;
  }

  try {
    const result = await compareFaces(referenceKey, deliveryKey);
    const faceStatus = result.matched ? "Verified" : result.reason === "no_face_in_target" ? "NoFace" : result.reason === "no_reference_photo" ? "NoReference" : "Failed";
    const verificationToken = await mintFaceProof(Number(farmerId), Number(dispatchId), faceStatus, result.similarity);
    await logAudit(req, "FACE_COMPARE", "PoD", `Face compare farmer ${farmerId}: ${faceStatus} (${result.similarity ?? "n/a"}%)`, "farmer", farmerId);
    res.json({ ...result, faceStatus, verificationToken });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/analyse-labels", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const { s3Key } = req.body as { s3Key?: string };
  if (!s3Key) { res.status(400).json({ error: "s3Key is required" }); return; }
  try {
    const result = await detectLabels(s3Key);
    await logAudit(req, "ANALYSE", "PoD", `Label analysis on photo: ${s3Key} — agri=${result.hasAgriContent}`, "pod", undefined);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/analyse-farmer", requireAnyAuth, async (req, res) => {
  const { s3Key, farmerId } = req.body as { s3Key?: string; farmerId?: number };
  if (!s3Key || !farmerId) { res.status(400).json({ error: "s3Key and farmerId are required" }); return; }
  if (!(await canAccessFarmer(req, Number(farmerId))) || !keyForFarmer(s3Key, Number(farmerId), ["reference", "delivery"])) {
    res.status(403).json({ error: "Forbidden", message: "Photo key is not authorized for this farmer" });
    return;
  }
  try {
    const result = await detectFaces(s3Key);
    await logAudit(req, "ANALYSE", "Farmers", `Face attribute analysis for farmer ${farmerId ?? "unknown"}: ${result.faceCount} face(s) detected`, "farmer", farmerId ?? undefined);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/api/face/find-farmer", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (req, res) => {
  const { photoKey } = req.body as { photoKey?: string };
  if (!photoKey) { res.status(400).json({ error: "photoKey is required" }); return; }
  if (!photoKey.startsWith("identify/")) {
    res.status(400).json({ error: "photoKey must be an identification upload" });
    return;
  }

  const { data: farmers } = await supa
    .from("farmers")
    .select("id, first_name, last_name, farmer_code, gender, age_group, beneficiary_type, group_size, farmer_group, photo_url")
    .not("photo_url", "is", null)
    .limit(100);

  if (!farmers || farmers.length === 0) {
    res.json({ matched: false, farmer: null, similarity: null, reason: "no_reference_photos" });
    return;
  }

  const results = await Promise.allSettled(
    (farmers as any[]).map(async (f) => ({
      farmer: f,
      compare: await compareFaces(f.photo_url, photoKey),
    }))
  );

  type Resolved = { farmer: any; compare: { similarity: number | null } };
  const matches: Resolved[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.compare.similarity != null && r.value.compare.similarity >= 70) {
      matches.push(r.value);
    }
  }
  matches.sort((a, b) => (b.compare.similarity ?? 0) - (a.compare.similarity ?? 0));

  if (matches.length === 0) {
    res.json({ matched: false, farmer: null, similarity: null, reason: "no_match" });
    return;
  }

  const best = matches[0];
  const f = best.farmer;
  const similarity = best.compare.similarity;

  await logAudit(req, "FACE_IDENTIFY", "Farmers",
    `Face identification matched farmer ${f.id} at ${similarity}% similarity`, "farmer", f.id);

  res.json({
    matched: true,
    similarity,
    farmer: {
      id: f.id,
      firstName: f.first_name,
      lastName: f.last_name,
      farmerCode: f.farmer_code,
      gender: f.gender,
      ageGroup: f.age_group,
      beneficiaryType: f.beneficiary_type,
      groupSize: f.group_size,
      farmerGroup: f.farmer_group,
    },
  });
});

router.post("/api/face/save-reference", requireAnyAuth, requireRoleIfJwt("FieldOfficer", "Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const { farmerId, key, dispatchId } = req.body as { farmerId?: number; key?: string; dispatchId?: number };
  if (!farmerId || !key) { res.status(400).json({ error: "farmerId and key are required" }); return; }
  const fieldOfficer = (req.user?.role ?? req.supabaseUser?.role ?? "").toLowerCase() === "fieldofficer";
  if (fieldOfficer) {
    if (!dispatchId || !keyForFarmer(key, Number(farmerId), ["delivery"])) {
      res.status(400).json({ error: "Field officers must provide a dispatch-bound delivery photo" });
      return;
    }
    const { data: dispatch } = await supa.from("dispatches")
      .select("field_officer_id,campaign_id")
      .eq("id", Number(dispatchId))
      .maybeSingle();
    const { data: allocation } = dispatch ? await supa.from("allocations")
      .select("id")
      .eq("campaign_id", (dispatch as any).campaign_id)
      .eq("farmer_id", Number(farmerId))
      .in("status", ["Approved", "Pending"])
      .limit(1)
      .maybeSingle() : { data: null };
    if (!dispatch || !(await canReadDispatch(req, dispatch as any)) || !allocation) {
      res.status(403).json({ error: "Forbidden", message: "You may not set a reference for this farmer and dispatch" });
      return;
    }
  } else if (!keyForFarmer(key, Number(farmerId), ["reference", "delivery"])) {
    res.status(400).json({ error: "key is not bound to the requested farmer" });
    return;
  } else if (!(await canAccessFarmer(req, Number(farmerId)))) {
    res.status(403).json({ error: "Forbidden", message: "You may not replace this farmer's reference photo" });
    return;
  }
  let update = supa.from("farmers").update({ photo_url: key }).eq("id", farmerId);
  if (fieldOfficer) update = update.is("photo_url", null);
  const { data, error } = await update.select().maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(409).json({ error: "A reference photo already exists; management approval is required to replace it" }); return; }
  await logAudit(req, "UPDATE", "Farmers", `Saved reference photo for farmer ${farmerId}`, "farmer", farmerId);
  res.json({ success: true, photoUrl: key });
});

export default router;
