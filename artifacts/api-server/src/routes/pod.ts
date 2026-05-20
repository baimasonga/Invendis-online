import { Router } from "express";
import { supa, snakeToCamel, camelToSnake } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";

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

  // Resolve input item from scanned barcode if not already supplied
  if (!body.input_item_id && body.input_barcode) {
    const { data: item } = await supa
      .from("input_items")
      .select("id")
      .eq("barcode", String(body.input_barcode).trim())
      .eq("is_active", 1)
      .limit(1)
      .single();
    if (item) body.input_item_id = (item as any).id;
  }

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

  let gpsStatus = "Pending";
  const farmerLat = body.farmer_latitude != null ? Number(body.farmer_latitude) : null;
  const farmerLng = body.farmer_longitude != null ? Number(body.farmer_longitude) : null;

  if (farmerLat == null || farmerLng == null || isNaN(farmerLat) || isNaN(farmerLng)) {
    gpsStatus = "NoLocation";
  } else {
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

    if ((destLat == null || destLng == null) && (campaign as any)?.district_id) {
      const { data: district } = await supa
        .from("districts")
        .select("latitude, longitude")
        .eq("id", (campaign as any).district_id)
        .single();
      destLat = (district as any)?.latitude ?? null;
      destLng = (district as any)?.longitude ?? null;
      geofenceRadius = 2000;
    }

    if (destLat != null && destLng != null) {
      const distM = haversineMeters(farmerLat, farmerLng, destLat, destLng);
      gpsStatus = distM <= geofenceRadius ? "Verified" : "Mismatch";
    } else {
      gpsStatus = "Pending";
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

router.post("/api/pod/batch-approve", requireAnyAuth, async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  try {
    const userId = await resolveUserId(req);

    const { data: pods, error: podsErr } = await supa
      .from("pod")
      .select("id, farmer_id, campaign_id")
      .in("id", ids);
    if (podsErr) throw new Error(podsErr.message);

    const { error: updateErr } = await supa
      .from("pod")
      .update({ status: "Verified", approved_by: userId, approved_at: new Date().toISOString() })
      .in("id", ids);
    if (updateErr) throw new Error(updateErr.message);

    for (const pod of pods ?? []) {
      await supa
        .from("allocations")
        .update({ status: "Delivered", updated_at: new Date().toISOString() })
        .eq("farmer_id", (pod as any).farmer_id)
        .eq("campaign_id", (pod as any).campaign_id)
        .neq("status", "Delivered");
    }

    const campaignIds = [...new Set((pods ?? []).map((p: any) => p.campaign_id))];
    for (const cid of campaignIds) {
      const { count } = await supa
        .from("allocations")
        .select("*", { count: "exact", head: true })
        .eq("campaign_id", cid)
        .eq("status", "Delivered");
      await supa.from("campaigns").update({ delivered_count: count ?? 0 }).eq("id", cid);
    }

    await logAudit(req, "APPROVE", "PoD", `Batch approved ${ids.length} PoD(s)`, "pod", ids[0]);
    res.json({ approved: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/pod/:id/approve", requireAnyAuth, async (req, res) => {
  const podId = Number(req.params.id);
  try {
    const userId = await resolveUserId(req);

    const { data: pod, error: podErr } = await supa
      .from("pod")
      .select("farmer_id, campaign_id")
      .eq("id", podId)
      .single();
    if (podErr || !pod) { res.status(404).json({ error: "PoD not found" }); return; }
    const { farmer_id, campaign_id } = pod as any;

    const { error: updateErr } = await supa
      .from("pod")
      .update({ status: "Verified", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", podId);
    if (updateErr) throw new Error(updateErr.message);

    await supa
      .from("allocations")
      .update({ status: "Delivered", updated_at: new Date().toISOString() })
      .eq("farmer_id", farmer_id)
      .eq("campaign_id", campaign_id)
      .neq("status", "Delivered");

    const { count } = await supa
      .from("allocations")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign_id)
      .eq("status", "Delivered");
    await supa.from("campaigns").update({ delivered_count: count ?? 0 }).eq("id", campaign_id);

    await logAudit(req, "APPROVE", "PoD", `Approved PoD ID ${podId}`, "pod", podId);
    res.json({ id: podId, status: "Verified" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
