import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { query } from "../lib/db.js";
import { randomBytes } from "crypto";

// ── Helper: resolve integer user ID from JWT or Supabase token ────────────────
async function resolveUserId(req: import("express").Request): Promise<number | null> {
  if (req.user?.userId) return req.user.userId;
  if (req.supabaseUser?.email) {
    const { data: u } = await supa.from("users").select("id").eq("email", req.supabaseUser.email).limit(1).single();
    return (u as any)?.id ?? null;
  }
  return null;
}

const router = Router();

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/api/pod", requireAuth, async (req, res) => {
  const { campaignId, dispatchId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("pod").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (dispatchId) q = q.eq("dispatch_id", Number(dispatchId)) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data: snakeToCamel(data ?? []), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.get("/api/pod/stats", requireAuth, async (_req, res) => {
  const { data } = await supa.from("pod").select("status");
  const rows = data ?? [];
  res.json({
    total: rows.length,
    verified: rows.filter((r: any) => r.status === "Verified").length,
    pending: rows.filter((r: any) => r.status === "Pending").length,
    exceptions: rows.filter((r: any) => !["Verified", "Pending"].includes(r.status)).length,
  });
});

router.get("/api/pod/:id", requireAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("pod").select("*").eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  res.json(snakeToCamel(rows[0]));
});

router.post("/api/pod/submit", requireAuth, async (req, res) => {
  const podCode = "POD-" + randomBytes(4).toString("hex").toUpperCase();
  const body = camelToSnake(req.body) as Record<string, any>;

  let campaignId: number | null = body.campaign_id ?? null;

  if (!campaignId && body.dispatch_id) {
    const { data: dispatch } = await supa
      .from("dispatches")
      .select("campaign_id")
      .eq("id", Number(body.dispatch_id))
      .single();
    campaignId = (dispatch as any)?.campaign_id ?? null;
  }

  if (!campaignId) {
    const { data: first } = await supa.from("campaigns").select("id").order("id").limit(1).single();
    campaignId = (first as any)?.id ?? null;
  }

  if (!campaignId) {
    res.status(400).json({ error: "campaign_id is required and could not be resolved" });
    return;
  }

  // ── GPS status evaluation ──────────────────────────────────────────────────
  let gpsStatus = "Pending";
  const farmerLat = body.farmer_latitude != null ? Number(body.farmer_latitude) : null;
  const farmerLng = body.farmer_longitude != null ? Number(body.farmer_longitude) : null;

  if (farmerLat == null || farmerLng == null || isNaN(farmerLat) || isNaN(farmerLng)) {
    gpsStatus = "NoLocation";
  } else {
    // Look up the campaign's distribution site
    const { data: campaign } = await supa
      .from("campaigns")
      .select("distribution_site_id, district_id")
      .eq("id", campaignId)
      .single();

    const siteId = (campaign as any)?.distribution_site_id;
    let destLat: number | null = null;
    let destLng: number | null = null;
    let geofenceRadius = 500;

    if (siteId) {
      const { data: site } = await supa
        .from("distribution_sites")
        .select("latitude, longitude, geofence_radius")
        .eq("id", siteId)
        .single();
      destLat = (site as any)?.latitude ?? null;
      destLng = (site as any)?.longitude ?? null;
      geofenceRadius = (site as any)?.geofence_radius ?? 500;
    }

    // Fall back to district centre if no distribution site coordinates
    if ((destLat == null || destLng == null) && (campaign as any)?.district_id) {
      const { data: district } = await supa
        .from("districts")
        .select("latitude, longitude")
        .eq("id", (campaign as any).district_id)
        .single();
      destLat = (district as any)?.latitude ?? null;
      destLng = (district as any)?.longitude ?? null;
      geofenceRadius = 2000; // wider radius for district-level reference
    }

    if (destLat != null && destLng != null) {
      const distM = haversineMeters(farmerLat, farmerLng, destLat, destLng);
      gpsStatus = distM <= geofenceRadius ? "Verified" : "Mismatch";
    } else {
      gpsStatus = "Pending"; // no reference coordinates configured
    }
  }

  const { data, error } = await supa.from("pod").insert({
    ...body,
    campaign_id: campaignId,
    pod_code: podCode,
    status: "Pending",
    gps_status: gpsStatus,
    submitted_at: new Date().toISOString(),
    field_officer_id: req.user!.userId,
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "SUBMIT", "PoD", `Submitted PoD: ${podCode}`, "pod", (data as any).id);
  res.status(201).json(snakeToCamel(data));
});

router.post("/api/pod/:id/approve-exception", requireAuth, async (req, res) => {
  const { notes } = req.body;
  const { data, error } = await supa.from("pod").update({ status: "Verified", approved_by: req.user!.userId, approved_at: new Date().toISOString(), notes }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE_EXCEPTION", "PoD", `Approved PoD exception ID ${req.params.id}`, "pod", (data as any).id);
  res.json(snakeToCamel(data));
});

// ── Batch-approve PoDs and mark each allocation Delivered ─────────────────────
// NOTE: must be defined before /:id/approve to avoid Express matching "batch-approve" as an id
router.post("/api/pod/batch-approve", requireAnyAuth, async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  try {
    const userId = await resolveUserId(req);

    // 1. Fetch all pods to get farmer/campaign pairs
    const podRes = await query(
      `SELECT id, farmer_id, campaign_id FROM pod WHERE id = ANY($1::int[])`,
      [ids]
    );
    const pods = podRes.rows;

    // 2. Update all pods → Verified
    await query(
      `UPDATE pod SET status='Verified', approved_by=$1, approved_at=NOW()
        WHERE id = ANY($2::int[])`,
      [userId, ids]
    );

    // 3. Mark each allocation → Delivered
    for (const pod of pods) {
      await query(
        `UPDATE allocations
            SET status='Delivered', updated_at=NOW()
          WHERE farmer_id=$1 AND campaign_id=$2 AND status != 'Delivered'`,
        [pod.farmer_id, pod.campaign_id]
      );
    }

    // 4. Refresh delivered_count for every affected campaign (deduplicated)
    const campaignIds = [...new Set(pods.map((p: any) => p.campaign_id))];
    for (const cid of campaignIds) {
      await query(
        `UPDATE campaigns
            SET delivered_count=(SELECT COUNT(*) FROM allocations WHERE campaign_id=$1 AND status='Delivered')
          WHERE id=$1`,
        [cid]
      );
    }

    await logAudit(req, "APPROVE", "PoD", `Batch approved ${ids.length} PoD(s)`, "pod", ids[0]);
    res.json({ approved: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Approve a single PoD and mark the allocation Delivered ────────────────────
router.post("/api/pod/:id/approve", requireAnyAuth, async (req, res) => {
  const podId = Number(req.params.id);
  try {
    const userId = await resolveUserId(req);

    // 1. Fetch pod so we know farmer_id + campaign_id
    const podRes = await query(
      `SELECT farmer_id, campaign_id FROM pod WHERE id = $1`,
      [podId]
    );
    if (!podRes.rows.length) { res.status(404).json({ error: "PoD not found" }); return; }
    const { farmer_id, campaign_id } = podRes.rows[0];

    // 2. Update pod → Verified
    await query(
      `UPDATE pod SET status='Verified', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [userId, podId]
    );

    // 3. Mark matching allocation → Delivered
    await query(
      `UPDATE allocations
          SET status='Delivered', updated_at=NOW()
        WHERE farmer_id=$1 AND campaign_id=$2 AND status != 'Delivered'`,
      [farmer_id, campaign_id]
    );

    // 4. Refresh campaign delivered_count
    await query(
      `UPDATE campaigns
          SET delivered_count=(
            SELECT COUNT(*) FROM allocations
            WHERE campaign_id=$1 AND status='Delivered'
          )
        WHERE id=$1`,
      [campaign_id]
    );

    await logAudit(req, "APPROVE", "PoD", `Approved PoD ID ${podId}`, "pod", podId);
    res.json({ id: podId, status: "Verified" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
