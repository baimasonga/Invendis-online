import { Router } from "express";
import { supa, snakeToCamel, camelToSnake, pool } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoles, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { randomBytes } from "crypto";
import { getPresignedUploadUrl, bucket } from "../lib/aws.js";
import { sendSms } from "../lib/sms.js";

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
  const { campaignId, dispatchId, status, faceStatus, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("pod").select("*, farmers(first_name, last_name, farmer_group, beneficiary_type, group_size, photo_url)", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (dispatchId) q = q.eq("dispatch_id", Number(dispatchId)) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (faceStatus) q = q.eq("face_status", faceStatus) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const flat = (data ?? []).map((row: any) => {
    const { farmers, ...rest } = row;
    const firstName = farmers?.first_name ?? null;
    const lastName  = farmers?.last_name  ?? null;
    return {
      ...rest,
      farmer_first_name:       firstName,
      farmer_last_name:        lastName,
      farmer_name:             [firstName, lastName].filter(Boolean).join(" ") || null,
      farmer_group:            farmers?.farmer_group    ?? null,
      farmer_beneficiary_type: farmers?.beneficiary_type ?? null,
      beneficiary_type:        farmers?.beneficiary_type ?? null,
      group_size:              farmers?.group_size       ?? null,
      reference_photo_key:     farmers?.photo_url        ?? null,
    };
  });
  res.json({ data: snakeToCamel(flat), total: count ?? 0, page: Number(page), limit: Number(limit) });
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
  // Whitelist allowed fields — never spread req.body directly to prevent mass-assignment attacks
  const raw = req.body as Record<string, any>;
  const body: Record<string, any> = {
    dispatch_id:       raw.dispatchId      != null ? Number(raw.dispatchId)      : null,
    campaign_id:       raw.campaignId      != null ? Number(raw.campaignId)      : null,
    farmer_id:         raw.farmerId        != null ? Number(raw.farmerId)        : null,
    input_item_id:     raw.inputItemId     != null ? Number(raw.inputItemId)     : null,
    input_barcode:     raw.inputBarcode    ?? null,
    quantity_delivered: raw.quantityDelivered != null ? Number(raw.quantityDelivered) : null,
    farmer_latitude:   raw.farmerLatitude  != null ? Number(raw.farmerLatitude)  : null,
    farmer_longitude:  raw.farmerLongitude != null ? Number(raw.farmerLongitude) : null,
    face_status:       raw.faceStatus      ?? null,
    face_similarity:   raw.faceSimilarity  != null ? Number(raw.faceSimilarity)  : null,
    face_photo_key:    raw.facePhotoKey    ?? null,
    photo_keys:        Array.isArray(raw.photoKeys) ? raw.photoKeys : null,
    notes:             raw.notes           ?? null,
    override_reason:   raw.overrideReason  ?? null,
    otp_verified:      raw.otpVerified     === true,
  };

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
    res.status(400).json({ error: "campaign_id is required — provide campaign_id directly or a valid dispatch_id" });
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

  // Use direct pg to bypass PostgREST schema cache (same pattern as dispatch insert)
  const insertFields: Record<string, unknown> = {
    ...body,
    campaign_id:      campaignId,
    pod_code:         podCode,
    status:           "Pending",
    gps_status:       gpsStatus,
    submitted_at:     new Date().toISOString(),
    field_officer_id: req.user!.userId,
  };
  // Remove undefined values; keep null (explicit nulls are fine for pg)
  const cols = Object.keys(insertFields).filter(k => insertFields[k] !== undefined);
  const vals = cols.map(k => insertFields[k]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO pod (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;

  let podRow: Record<string, unknown>;
  try {
    const result = await pool.query(sql, vals);
    podRow = result.rows[0];
  } catch (pgErr: any) {
    res.status(500).json({ error: pgErr.message }); return;
  }

  // Update farmer's group_size if field officer adjusted it
  const actualGroupSizeVal = (req.body as any).actualGroupSize;
  if (actualGroupSizeVal && body.farmer_id) {
    try {
      await supa.from("farmers")
        .update({ group_size: Number(actualGroupSizeVal) })
        .eq("id", body.farmer_id);
    } catch { /* best-effort: don't fail PoD submit if group_size update fails */ }
  }

  await logAudit(req, "SUBMIT", "PoD", `Submitted PoD: ${podCode}`, "pod", podRow.id as number);
  res.status(201).json(snakeToCamel(podRow));
});

router.post("/api/pod/:id/override-face", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { reason } = req.body as { reason: string };
  if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }
  const { data, error } = await supa.from("pod")
    .update({ face_status: "Override", override_reason: reason })
    .eq("id", Number(req.params.id))
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "OVERRIDE_FACE", "PoD", `Supervisor override face verification for PoD ID ${req.params.id}: ${reason}`, "pod", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/pod/:id/approve-exception", requireAuth, requireRoles("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { notes } = req.body;
  const { data, error } = await supa.from("pod").update({ status: "Verified", approved_by: req.user!.userId, approved_at: new Date().toISOString(), notes }).eq("id", Number(req.params.id)).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await logAudit(req, "APPROVE_EXCEPTION", "PoD", `Approved PoD exception ID ${req.params.id}`, "pod", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/pod/batch-approve", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: "ids array is required" });
    return;
  }
  try {
    const userId = await resolveUserId(req);

    const { data: pods, error: podsErr } = await supa
      .from("pod")
      .select("id, farmer_id, campaign_id, dispatch_id, input_item_id, quantity_delivered")
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

    // Update dispatch_items.quantity_delivered and dispatches.delivered_packages per dispatch
    const dispatchIds = [...new Set((pods ?? []).map((p: any) => p.dispatch_id).filter(Boolean))];
    for (const did of dispatchIds) {
      const dispPods = (pods ?? []).filter((p: any) => p.dispatch_id === did && p.input_item_id && p.quantity_delivered);
      for (const p of dispPods as any[]) {
        const qty = Number(p.quantity_delivered);
        const { data: dispItem } = await supa
          .from("dispatch_items")
          .select("id, quantity_delivered")
          .eq("dispatch_id", did)
          .eq("input_item_id", p.input_item_id)
          .single();
        if (dispItem) {
          const newQty = ((dispItem as any).quantity_delivered ?? 0) + qty;
          await supa.from("dispatch_items")
            .update({ quantity_delivered: newQty })
            .eq("id", (dispItem as any).id);
        }
      }
      const { data: allItems } = await supa
        .from("dispatch_items")
        .select("quantity_delivered")
        .eq("dispatch_id", did);
      const totalDelivered = (allItems ?? []).reduce((s: number, i: any) => s + Number(i.quantity_delivered ?? 0), 0);
      await supa.from("dispatches")
        .update({ delivered_packages: Math.round(totalDelivered), updated_at: new Date().toISOString() })
        .eq("id", did);
    }

    await logAudit(req, "APPROVE", "PoD", `Batch approved ${ids.length} PoD(s)`, "pod", ids[0]);
    res.json({ approved: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/pod/:id/approve", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const podId = Number(req.params.id);
  try {
    const userId = await resolveUserId(req);

    const { data: pod, error: podErr } = await supa
      .from("pod")
      .select("farmer_id, campaign_id, dispatch_id, input_item_id, quantity_delivered")
      .eq("id", podId)
      .single();
    if (podErr || !pod) { res.status(404).json({ error: "PoD not found" }); return; }
    const { farmer_id, campaign_id, dispatch_id, input_item_id, quantity_delivered } = pod as any;

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

    // Update dispatch_items.quantity_delivered and dispatches.delivered_packages
    if (dispatch_id && input_item_id && quantity_delivered) {
      const qty = Number(quantity_delivered);
      const { data: dispItem } = await supa
        .from("dispatch_items")
        .select("id, quantity_delivered")
        .eq("dispatch_id", dispatch_id)
        .eq("input_item_id", input_item_id)
        .single();
      if (dispItem) {
        const newQty = ((dispItem as any).quantity_delivered ?? 0) + qty;
        await supa.from("dispatch_items")
          .update({ quantity_delivered: newQty })
          .eq("id", (dispItem as any).id);
      }
      // Recalculate dispatches.delivered_packages
      const { data: allItems } = await supa
        .from("dispatch_items")
        .select("quantity_delivered")
        .eq("dispatch_id", dispatch_id);
      const totalDelivered = (allItems ?? []).reduce((s: number, i: any) => s + Number(i.quantity_delivered ?? 0), 0);
      await supa.from("dispatches")
        .update({ delivered_packages: Math.round(totalDelivered), updated_at: new Date().toISOString() })
        .eq("id", dispatch_id);
    }

    // SMS notification to farmer (non-fatal)
    try {
      const { data: farmer } = await supa.from("farmers")
        .select("phone, first_name, last_name, farmer_group")
        .eq("id", farmer_id)
        .single();
      const phone = (farmer as any)?.phone;
      if (phone) {
        const name = (farmer as any)?.farmer_group
          || `${(farmer as any)?.first_name ?? ""} ${(farmer as any)?.last_name ?? ""}`.trim()
          || "Beneficiary";
        await sendSms(phone, `Dear ${name}, your delivery has been confirmed. Thank you. — Invendis SL`);
      }
    } catch (smsErr: any) {
      req.log.warn({ err: smsErr.message }, "PoD approval SMS failed");
    }

    await logAudit(req, "APPROVE", "PoD", `Approved PoD ID ${podId}`, "pod", podId);
    res.json({ id: podId, status: "Verified" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/pod/photo-upload-url", requireAnyAuth, async (req, res) => {
  const { farmerId, photoIndex } = req.body as { farmerId?: number; photoIndex?: number };
  if (!farmerId) { res.status(400).json({ error: "farmerId is required" }); return; }
  const idx = Number.isFinite(Number(photoIndex)) ? Number(photoIndex) : 0;
  const key = `pods/${farmerId}/${Date.now()}-photo-${idx}.jpg`;
  try {
    const url = await getPresignedUploadUrl(key, "image/jpeg");
    res.json({ uploadUrl: url, key, bucket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
