import { Router } from "express";
import QRCode from "qrcode";
import { requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { canReadDispatch } from "../lib/dispatch-auth.js";
import { logAudit } from "../lib/audit.js";
import { DELIVERABLE_ALLOCATION_STATUSES } from "../lib/entitlements.js";
import { supa } from "../lib/supabase.js";
import {
  OFFLINE_ARRIVAL_POLICY,
  assessArrivalEvidence,
  createOfflinePin,
  createOfflineVoucher,
  credentialHash,
  type ArrivalFix,
} from "../lib/offline-delivery.js";

const router = Router();
const OPERATIONAL_ROLES = ["Admin", "ProjectManager", "WarehouseManager", "DistrictCoordinator", "FieldOfficer"];

async function actorIntegerId(req: any): Promise<number | null> {
  if (req.user?.userId) return Number(req.user.userId);
  if (!req.supabaseUser?.email) return null;
  const { data } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).maybeSingle();
  return (data as any)?.id ?? null;
}

async function loadDispatchForRequest(req: any, id: number) {
  const { data } = await supa.from("dispatches")
    .select("id,campaign_id,vehicle_id,field_officer_id,status,campaigns(distribution_site_id,district_id,end_date)")
    .eq("id", id).maybeSingle();
  if (!data || !(await canReadDispatch(req, data as any))) return null;
  return data as any;
}

async function preciseDestination(dispatch: any) {
  const siteId = dispatch?.campaigns?.distribution_site_id;
  if (!siteId) return null;
  const { data } = await supa.from("distribution_sites")
    .select("id,name,latitude,longitude,geofence_radius")
    .eq("id", siteId).maybeSingle();
  if (!data || data.latitude == null || data.longitude == null) return null;
  return {
    id: data.id,
    name: data.name,
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    geofenceRadiusM: Number(data.geofence_radius ?? 500),
  };
}

router.post(
  "/api/dispatch/:id/offline-credentials/issue",
  requireAnyAuth,
  requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"),
  async (req, res) => {
    const dispatchId = Number(req.params.id);
    const dispatch = await loadDispatchForRequest(req, dispatchId);
    if (!dispatch) { res.status(404).json({ error: "Dispatch not found or outside your scope" }); return; }
    const signingSecret = process.env.OFFLINE_VOUCHER_SIGNING_SECRET ?? process.env.SESSION_SECRET ?? "";
    if (signingSecret.length < 32) {
      res.status(503).json({ error: "Offline voucher signing is not configured" });
      return;
    }
    const { data: allocations, error } = await supa.from("allocations")
      .select("farmer_id,farmers(id,farmer_code,first_name,last_name,beneficiary_type)")
      .eq("campaign_id", dispatch.campaign_id)
      .in("status", DELIVERABLE_ALLOCATION_STATUSES);
    if (error) { res.status(500).json({ error: error.message }); return; }
    const requestedDays = Number(req.body?.validDays ?? 30);
    const validDays = Math.min(90, Math.max(1, Number.isFinite(requestedDays) ? requestedDays : 30));
    const expiresAt = new Date(Date.now() + validDays * 86_400_000).toISOString();
    const issuedBy = await actorIntegerId(req);
    const credentials: any[] = [];
    const proofRows: Array<Record<string, unknown>> = [];
    for (const allocation of allocations ?? []) {
      const farmer: any = (allocation as any).farmers;
      if (!farmer?.id) continue;
      const voucher = createOfflineVoucher({ dispatchId, farmerId: farmer.id, expiresAt, signingSecret });
      const pin = createOfflinePin();
      proofRows.push(
        { token_hash: credentialHash(voucher), method: "offline_qr", farmer_id: farmer.id, expires_at: expiresAt },
        { token_hash: credentialHash(pin), method: "offline_pin", farmer_id: farmer.id, expires_at: expiresAt },
      );
      credentials.push({
        farmerId: farmer.id,
        farmerCode: farmer.farmer_code,
        farmerName: `${farmer.first_name ?? ""} ${farmer.last_name ?? ""}`.trim(),
        beneficiaryType: farmer.beneficiary_type,
        voucher,
        voucherQrDataUrl: await QRCode.toDataURL(voucher, { width: 280, margin: 1, errorCorrectionLevel: "M" }),
        pin,
        expiresAt,
      });
    }
    if (!proofRows.length) {
      res.status(422).json({ error: "This dispatch has no deliverable beneficiaries" });
      return;
    }
    const { error: issueError } = await supa.rpc("issue_offline_verification_proofs", {
      p_dispatch_id: dispatchId,
      p_issued_by: issuedBy,
      p_proofs: proofRows,
    });
    if (issueError) { res.status(500).json({ error: issueError.message }); return; }
    await logAudit(req, "ISSUE_OFFLINE_CREDENTIALS", "PoD", `Issued offline credentials for dispatch ${dispatchId}`, "dispatch", dispatchId, { count: credentials.length, expiresAt });
    res.json({ dispatchId, expiresAt, credentials });
  },
);

router.get("/api/dispatch/:id/offline-pack", requireAnyAuth, requireRoleIfJwt(...OPERATIONAL_ROLES), async (req, res) => {
  const dispatchId = Number(req.params.id);
  const dispatch = await loadDispatchForRequest(req, dispatchId);
  if (!dispatch) { res.status(404).json({ error: "Dispatch not found or outside your scope" }); return; }
  const destination = await preciseDestination(dispatch);
  const { data: proofs, error } = await supa.from("pod_verification_proofs")
    .select("farmer_id,token_hash,method,expires_at")
    .eq("dispatch_id", dispatchId)
    .in("method", ["offline_qr", "offline_pin"])
    .is("consumed_at", null).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({
    version: 1,
    generatedAt: new Date().toISOString(),
    dispatchId,
    vehicleId: dispatch.vehicle_id,
    destination,
    arrivalPolicy: OFFLINE_ARRIVAL_POLICY,
    credentials: proofs ?? [],
  });
});

router.post("/api/dispatch/:id/arrival-evidence", requireAnyAuth, requireRoleIfJwt(...OPERATIONAL_ROLES), async (req, res) => {
  const dispatchId = Number(req.params.id);
  const dispatch = await loadDispatchForRequest(req, dispatchId);
  if (!dispatch) { res.status(404).json({ error: "Dispatch not found or outside your scope" }); return; }
  const destination = await preciseDestination(dispatch);
  if (!destination) {
    res.status(422).json({ error: "A precise distribution-site coordinate is required for GPS arrival verification" });
    return;
  }
  const evidenceKey = typeof req.body?.evidenceKey === "string" ? req.body.evidenceKey.trim().slice(0, 128) : "";
  const fixes = Array.isArray(req.body?.fixes) ? req.body.fixes as ArrivalFix[] : [];
  if (!evidenceKey || fixes.length === 0 || fixes.length > 120) {
    res.status(400).json({ error: "evidenceKey and 1-120 GNSS fixes are required" });
    return;
  }
  const assessment = assessArrivalEvidence(fixes, destination);
  if (assessment.validFixes.length === 0) { res.status(400).json({ error: "No valid GNSS fixes were supplied" }); return; }
  const record = {
    evidence_key: evidenceKey,
    dispatch_id: dispatchId,
    vehicle_id: dispatch.vehicle_id,
    source: "mobile_gnss",
    verification_status: assessment.status,
    destination_latitude: destination.latitude,
    destination_longitude: destination.longitude,
    geofence_radius_m: destination.geofenceRadiusM,
    fixes,
    fix_count: assessment.validFixes.length,
    acceptable_fix_count: assessment.acceptableFixCount,
    first_captured_at: new Date(assessment.validFixes[0].capturedMs).toISOString(),
    last_captured_at: new Date(assessment.validFixes[assessment.validFixes.length - 1].capturedMs).toISOString(),
    dwell_seconds: assessment.dwellSeconds,
    minimum_distance_m: assessment.minimumDistanceM,
    best_accuracy_m: assessment.bestAccuracyM,
    device_id: typeof req.body?.deviceId === "string" ? req.body.deviceId.slice(0, 200) : null,
    captured_by: await actorIntegerId(req),
  };
  let { data, error } = await supa.from("dispatch_arrival_evidence").insert(record).select("*").single();
  if (error && /duplicate key/i.test(error.message)) {
    ({ data, error } = await supa.from("dispatch_arrival_evidence").select("*")
      .eq("evidence_key", evidenceKey).eq("dispatch_id", dispatchId).maybeSingle());
    if (!data && !error) {
      res.status(409).json({ error: "evidenceKey has already been used for another dispatch" });
      return;
    }
  }
  if (error || !data) { res.status(500).json({ error: error?.message ?? "Unable to save arrival evidence" }); return; }
  if (assessment.status === "GPS Verified" && dispatch.status === "In Transit") {
    await supa.from("dispatches").update({ status: "Arrived", arrived_at: record.last_captured_at, updated_at: new Date().toISOString() })
      .eq("id", dispatchId).eq("status", "In Transit").is("arrived_at", null);
  }
  await logAudit(req, "CAPTURE_ARRIVAL_EVIDENCE", "Dispatch", `Captured ${assessment.status} arrival evidence for dispatch ${dispatchId}`, "dispatch", dispatchId, { evidenceKey, acceptableFixCount: assessment.acceptableFixCount, dwellSeconds: assessment.dwellSeconds });
  res.json({ id: data.id, evidenceKey, verificationStatus: data.verification_status, acceptableFixCount: data.acceptable_fix_count, dwellSeconds: data.dwell_seconds, minimumDistanceM: data.minimum_distance_m, bestAccuracyM: data.best_accuracy_m });
});

export default router;
