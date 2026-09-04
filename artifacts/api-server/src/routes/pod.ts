import { Router } from "express";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { requireAuth, requireAnyAuth, requireRoles, requireRoleIfJwt } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { createHash, randomBytes } from "crypto";
import { districtCoords, DISTRICT_GEOFENCE_RADIUS_M } from "../lib/district-coords.js";
import { bucket } from "../lib/aws.js";
import { generateProxyUploadUrl } from "../lib/auth.js";
import { sendSms } from "../lib/sms.js";
import { canReadDispatch, getDispatchReadScope } from "../lib/dispatch-auth.js";

const OPERATIONAL_ROLES = ["FieldOfficer", "Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"];

function actorRole(req: import("express").Request): string {
  return (req.user?.role ?? req.supabaseUser?.role ?? "").toLowerCase();
}

async function activeOperationalUserId(req: import("express").Request): Promise<number | null> {
  const id = await resolveUserId(req);
  if (!id) return null;
  const { data } = await supa.from("users").select("id,is_active").eq("id", id).maybeSingle();
  return (data as any)?.is_active === true || (data as any)?.is_active === 1 ? id : null;
}

async function canReadPod(req: import("express").Request, pod: any): Promise<boolean> {
  const scope = await getDispatchReadScope(req);
  if (scope.unrestricted) return true;
  if (scope.fieldOfficerId !== undefined) return Number(pod.field_officer_id) === scope.fieldOfficerId;
  return !!pod.campaign_id && (scope.campaignIds ?? []).includes(Number(pod.campaign_id));
}

async function loadAuthorizedPod(req: import("express").Request, podId: number): Promise<any | null> {
  const { data } = await supa.from("pod")
    .select("id,status,campaign_id,dispatch_id,field_officer_id")
    .eq("id", podId)
    .maybeSingle();
  return data && await canReadPod(req, data) ? data : null;
}

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

router.get("/api/pod", requireAnyAuth, async (req, res) => {
  const { campaignId, dispatchId, status, faceStatus, page = "1", limit = "20" } = req.query as Record<string, string>;
  const offset = (Number(page) - 1) * Number(limit);
  let q = supa.from("pod").select(
    "*, farmers(first_name, last_name, farmer_group, beneficiary_type, group_size, photo_url), pod_items(id, input_item_id, quantity_delivered, input_items(name, unit, category))",
    { count: "exact" }
  ).order("created_at", { ascending: false }).range(offset, offset + Number(limit) - 1);
  const scope = await getDispatchReadScope(req);
  if (!scope.unrestricted) {
    if (scope.fieldOfficerId !== undefined) q = q.eq("field_officer_id", scope.fieldOfficerId) as typeof q;
    else q = q.in("campaign_id", scope.campaignIds ?? []) as typeof q;
  }
  if (campaignId) q = q.eq("campaign_id", Number(campaignId)) as typeof q;
  if (dispatchId) q = q.eq("dispatch_id", Number(dispatchId)) as typeof q;
  if (status) q = q.eq("status", status) as typeof q;
  if (faceStatus) q = q.eq("face_status", faceStatus) as typeof q;
  const { data, count, error } = await q;
  if (error) { res.status(500).json({ error: error.message }); return; }
  const flat = (data ?? []).map((row: any) => {
    const { farmers, pod_items, ...rest } = row;
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
      items: (pod_items ?? []).map((pi: any) => ({
        id:                 pi.id,
        input_item_id:      pi.input_item_id,
        quantity_delivered: pi.quantity_delivered,
        input_item_name:    pi.input_items?.name ?? null,
        unit:               pi.input_items?.unit ?? null,
        category:           pi.input_items?.category ?? null,
      })),
    };
  });
  res.json({ data: snakeToCamel(flat), total: count ?? 0, page: Number(page), limit: Number(limit) });
});

router.get("/api/pod/stats", requireAnyAuth, async (req, res) => {
  let q = supa.from("pod").select("status");
  const scope = await getDispatchReadScope(req);
  if (!scope.unrestricted) {
    if (scope.fieldOfficerId !== undefined) q = q.eq("field_officer_id", scope.fieldOfficerId);
    else q = q.in("campaign_id", scope.campaignIds ?? []);
  }
  const { data } = await q;
  const rows = data ?? [];
  res.json({
    total: rows.length,
    verified: rows.filter((r: any) => r.status === "Verified").length,
    pending: rows.filter((r: any) => r.status === "Pending").length,
    exceptions: rows.filter((r: any) => !["Verified", "Pending"].includes(r.status)).length,
  });
});

router.get("/api/pod/:id", requireAnyAuth, async (req, res) => {
  const { data: rows, error } = await supa.from("pod")
    .select("*, pod_items(id, input_item_id, quantity_delivered, input_items(name, unit, category))")
    .eq("id", Number(req.params.id)).limit(1);
  if (error || !rows?.length) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canReadPod(req, rows[0]))) { res.status(404).json({ error: "Not found" }); return; }
  const { pod_items, ...rest } = rows[0] as any;
  const result = {
    ...rest,
    items: (pod_items ?? []).map((pi: any) => ({
      id:                 pi.id,
      input_item_id:      pi.input_item_id,
      quantity_delivered: pi.quantity_delivered,
      input_item_name:    pi.input_items?.name ?? null,
      unit:               pi.input_items?.unit ?? null,
      category:           pi.input_items?.category ?? null,
    })),
  };
  res.json(snakeToCamel(result));
});

router.post(["/api/pod", "/api/pod/submit"], requireAnyAuth, async (req, res) => {
  if (!OPERATIONAL_ROLES.map(r => r.toLowerCase()).includes(actorRole(req))) {
    res.status(403).json({ error: "Forbidden", message: "An operational role is required to submit PoD" });
    return;
  }
  const fieldOfficerId = await activeOperationalUserId(req);
  if (fieldOfficerId === null) {
    res.status(403).json({ error: "Your account is not linked to an active operational user" });
    return;
  }
  const podCode = "POD-" + randomBytes(4).toString("hex").toUpperCase();
  // Whitelist allowed fields — never spread req.body directly to prevent mass-assignment attacks
  const raw = req.body as Record<string, any>;

  // Multi-item PoD: items array [{inputItemId, quantity}]
  let items: { inputItemId: number; quantity: number }[] | null = Array.isArray(raw.items)
    ? (raw.items as { inputItemId: number; quantity: number }[]).filter(i => Number(i.quantity) > 0)
    : null;

  const body: Record<string, any> = {
    dispatch_id:       raw.dispatchId      != null ? Number(raw.dispatchId)      : null,
    campaign_id:       null,
    farmer_id:         raw.farmerId        != null ? Number(raw.farmerId)        : null,
    // For multi-item: use first item id; for single item: use inputItemId directly
    input_item_id:     raw.inputItemId     != null ? Number(raw.inputItemId)
                       : (items && items[0]) ? Number(items[0].inputItemId)      : null,
    input_barcode:     raw.inputBarcode    ?? null,
    // For multi-item: total of all items; for single: direct value
    quantity_delivered: items && items.length > 0
                       ? items.reduce((s, i) => s + Number(i.quantity), 0)
                       : raw.quantityDelivered != null ? Number(raw.quantityDelivered) : null,
    farmer_latitude:   raw.farmerLatitude  != null ? Number(raw.farmerLatitude)  : null,
    farmer_longitude:  raw.farmerLongitude != null ? Number(raw.farmerLongitude) : null,
    face_photo_key:    raw.facePhotoKey    ?? null,
    photo_keys:        Array.isArray(raw.photoKeys) ? raw.photoKeys : null,
    photo_gps_coords:  Array.isArray(raw.photoGpsCoords) ? raw.photoGpsCoords : null,
    notes:             raw.notes           ?? null,
    override_reason:   raw.overrideReason  ?? null,
    otp_verification_hash: typeof raw.otpVerificationToken === "string" ? createHash("sha256").update(raw.otpVerificationToken).digest("hex") : null,
    face_verification_hash: typeof raw.faceVerificationToken === "string" ? createHash("sha256").update(raw.faceVerificationToken).digest("hex") : null,
    submission_key:    typeof raw.submissionKey === "string" && raw.submissionKey.trim() ? raw.submissionKey.trim().slice(0, 128) : null,
  };
  if (!body.dispatch_id) {
    res.status(400).json({ error: "dispatchId is required for PoD submission" });
    return;
  }
  const { data: authorizedDispatch, error: dispatchError } = await supa
    .from("dispatches").select("id,campaign_id,field_officer_id").eq("id", body.dispatch_id).maybeSingle();
  if (dispatchError || !authorizedDispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }
  if (!(await canReadDispatch(req, authorizedDispatch as any))) {
    res.status(403).json({ error: "Forbidden", message: "You may not submit to this dispatch" });
    return;
  }
  body.campaign_id = Number((authorizedDispatch as any).campaign_id);
  const { data: allocation } = await supa.from("allocations")
    .select("id")
    .eq("campaign_id", body.campaign_id)
    .eq("farmer_id", body.farmer_id)
    .in("status", ["Approved", "Pending"])
    .limit(1)
    .maybeSingle();
  if (!allocation) {
    res.status(403).json({
      error: "Forbidden",
      message: "This farmer is not eligible for delivery on the dispatch campaign",
    });
    return;
  }
  if (body.submission_key) {
    const { data: existing, error: existingError } = await supa.from("pod")
      .select("*").eq("submission_key", body.submission_key).maybeSingle();
    if (existingError) { res.status(500).json({ error: existingError.message }); return; }
    if (existing) {
      if (Number((existing as any).dispatch_id) !== body.dispatch_id) {
        res.status(409).json({ error: "submissionKey has already been used for another dispatch" });
        return;
      }
      res.status(200).json(snakeToCamel(existing));
      return;
    }
  }

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

  // A dispatch is a closed manifest: delivery items must come from that
  // manifest and may not consume more than its unissued balance.  Never trust
  // the item IDs or quantities supplied by a field device.
  if (body.dispatch_id) {
    const [{ data: dispatchItems, error: dispatchItemsErr }, { data: pendingPods, error: pendingPodsErr }] = await Promise.all([
      supa.from("dispatch_items").select("input_item_id, quantity_loaded, quantity_delivered").eq("dispatch_id", body.dispatch_id),
      supa.from("pod").select("id, input_item_id, quantity_delivered").eq("dispatch_id", body.dispatch_id).eq("status", "Pending"),
    ]);
    if (dispatchItemsErr || pendingPodsErr) {
      res.status(500).json({ error: dispatchItemsErr?.message ?? pendingPodsErr?.message ?? "Unable to validate dispatch items." });
      return;
    }

    // The legacy portal records one total quantity and does not expose an item
    // picker. Preserve that flow only where the manifest unambiguously has one
    // item; multi-item manifests must provide their explicit item quantities.
    if ((!items || items.length === 0) && !body.input_item_id && (dispatchItems ?? []).length === 1 && Number(body.quantity_delivered) > 0) {
      const soleItemId = Number((dispatchItems![0] as any).input_item_id);
      items = [{ inputItemId: soleItemId, quantity: Number(body.quantity_delivered) }];
      body.input_item_id = soleItemId;
    }
    const deliveryItems = items && items.length > 0
      ? items.map(i => ({ inputItemId: Number(i.inputItemId), quantity: Number(i.quantity) }))
      : body.input_item_id && Number(body.quantity_delivered) > 0
        ? [{ inputItemId: Number(body.input_item_id), quantity: Number(body.quantity_delivered) }]
        : [];
    if (!deliveryItems.length || deliveryItems.some(i => !Number.isInteger(i.inputItemId) || !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      res.status(400).json({ error: "A dispatch delivery requires at least one valid item and quantity." });
      return;
    }
    const requested = new Map<number, number>();
    for (const item of deliveryItems) {
      requested.set(item.inputItemId, (requested.get(item.inputItemId) ?? 0) + item.quantity);
    }
    const requestedIds = [...requested.keys()];
    const manifestItems = new Map((dispatchItems ?? []).map((item: any) => [Number(item.input_item_id), item]));
    const missing = requestedIds.filter(id => !manifestItems.has(id));
    if (missing.length) {
      res.status(422).json({ error: "dispatch_item_mismatch", message: "Submitted items are not on this dispatch.", inputItemIds: missing });
      return;
    }

    // Pending PoDs reserve stock as soon as they are submitted, preventing
    // multiple submissions from collectively exceeding a manifest before
    // supervisors approve them.
    const pendingIds = (pendingPods ?? []).map((pod: any) => Number(pod.id));
    const pendingByItem = new Map<number, number>();
    if (pendingIds.length) {
      const { data: pendingItemRows, error: pendingItemsErr } = await supa
        .from("pod_items")
        .select("pod_id, input_item_id, quantity_delivered")
        .in("pod_id", pendingIds);
      if (pendingItemsErr) {
        res.status(500).json({ error: pendingItemsErr.message });
        return;
      }
      const podsWithItems = new Set((pendingItemRows ?? []).map((row: any) => Number(row.pod_id)));
      for (const item of pendingItemRows ?? []) {
        const row = item as any;
        const id = Number(row.input_item_id);
        pendingByItem.set(id, (pendingByItem.get(id) ?? 0) + Number(row.quantity_delivered ?? 0));
      }
      for (const pod of pendingPods ?? []) {
        const row = pod as any;
        if (!podsWithItems.has(Number(row.id)) && row.input_item_id) {
          const id = Number(row.input_item_id);
          pendingByItem.set(id, (pendingByItem.get(id) ?? 0) + Number(row.quantity_delivered ?? 0));
        }
      }
    }

    const overages = requestedIds.flatMap(id => {
      const manifest = manifestItems.get(id) as any;
      const remaining = Number(manifest.quantity_loaded ?? 0) - Number(manifest.quantity_delivered ?? 0) - (pendingByItem.get(id) ?? 0);
      const quantity = requested.get(id)!;
      return quantity > remaining ? [{ inputItemId: id, requested: quantity, remaining: Math.max(0, remaining) }] : [];
    });
    if (overages.length) {
      res.status(422).json({ error: "dispatch_quantity_exceeded", message: "Submitted quantity exceeds the dispatch balance.", items: overages });
      return;
    }
  }

  const campaignId: number | null = body.campaign_id;

  if (!campaignId) {
    res.status(400).json({ error: "Cannot determine campaign: farmer has no active allocation and no dispatch was provided. Allocate the farmer to a campaign first, or record delivery via a dispatch." });
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
      const dc = districtCoords((campaign as any).district_id);
      if (dc) { destLat = dc.lat; destLng = dc.lng; geofenceRadius = DISTRICT_GEOFENCE_RADIUS_M; }
    }

    if (destLat != null && destLng != null) {
      const distM = haversineMeters(farmerLat, farmerLng, destLat, destLng);
      gpsStatus = distM <= geofenceRadius ? "Verified" : "Mismatch";
    } else {
      gpsStatus = "Pending";
    }
  }

  // Capture vehicle GPS snapshot (linked via dispatch → vehicle)
  let vehicleGpsSnapshot: { lat: number; lng: number; plateNumber: string; distanceM?: number } | null = null;
  if (body.dispatch_id) {
    const { data: dispVeh } = await supa.from("dispatches").select("vehicle_id").eq("id", Number(body.dispatch_id)).single();
    const vehicleId = (dispVeh as any)?.vehicle_id;
    if (vehicleId) {
      const { data: vehicle } = await supa.from("vehicles").select("plate_number, last_latitude, last_longitude").eq("id", vehicleId).single();
      const vLat = (vehicle as any)?.last_latitude != null ? Number((vehicle as any).last_latitude) : null;
      const vLng = (vehicle as any)?.last_longitude != null ? Number((vehicle as any).last_longitude) : null;
      if (vLat != null && vLng != null) {
        vehicleGpsSnapshot = {
          lat: vLat,
          lng: vLng,
          plateNumber: (vehicle as any)?.plate_number ?? "",
          ...(farmerLat != null && farmerLng != null ? { distanceM: Math.round(haversineMeters(farmerLat, farmerLng, vLat, vLng)) } : {}),
        };
      }
    }
  }

  // Look up farmer's community name (for result screen display)
  let communityName: string | null = null;
  if (body.farmer_id) {
    const { data: farmerComm } = await supa
      .from("farmers")
      .select("community_id")
      .eq("id", body.farmer_id)
      .single();
    const commId = (farmerComm as any)?.community_id;
    if (commId) {
      const { data: comm } = await supa.from("communities").select("name").eq("id", commId).single();
      communityName = (comm as any)?.name ?? null;
    }
  }

  // Build insert payload — filter undefined values, keep nulls
  const insertFields: Record<string, unknown> = Object.fromEntries(
    Object.entries({
      ...body,
      campaign_id:          campaignId,
      pod_code:             podCode,
      status:               "Pending",
      gps_status:           gpsStatus,
      vehicle_gps_snapshot: vehicleGpsSnapshot,
      submitted_at:         new Date().toISOString(),
      field_officer_id:     fieldOfficerId,
    }).filter(([, v]) => v !== undefined)
  );

  const atomicItems = items && items.length > 0
    ? items.map(i => ({ input_item_id: Number(i.inputItemId), quantity_delivered: Number(i.quantity) }))
    : body.dispatch_id && body.input_item_id && Number(body.quantity_delivered) > 0
      ? [{ input_item_id: Number(body.input_item_id), quantity_delivered: Number(body.quantity_delivered) }]
      : [];
  const { data: podInserted, error: insertErr } = await supa.rpc("submit_pod_atomic", {
    p_record: insertFields,
    p_items: atomicItems,
  });
  if (insertErr || !podInserted) {
    const message = insertErr?.message ?? "Failed to submit PoD";
    if (/cannot accept deliveries from status/i.test(message)) {
      res.status(409).json({ error: message });
      return;
    }
    if (/pod_one_active_delivery_per_farmer_campaign|duplicate key/i.test(message)) {
      res.status(409).json({ error: "An active delivery already exists for this farmer in this campaign." });
      return;
    }
    if (/verification proof/i.test(message)) {
      res.status(409).json({ error: message });
      return;
    }
    const validationFailure = /requires items|not on dispatch|exceeds remaining|positive finite|does not exist/i.test(message);
    res.status(validationFailure ? 422 : 500).json({ error: message });
    return;
  }
  let podRow = podInserted as Record<string, unknown>;

  // Check for duplicate delivery (same farmer already has a Verified or Pending PoD in this campaign)
  if (body.farmer_id && campaignId) {
    const { data: dupCheck } = await supa
      .from("pod")
      .select("id")
      .eq("farmer_id", body.farmer_id)
      .eq("campaign_id", campaignId)
      .in("status", ["Verified", "Pending"])
      .neq("id", podRow.id as number)
      .limit(1);
    if (dupCheck && dupCheck.length > 0) {
      await supa.from("pod").update({ duplicate_flag: true }).eq("id", podRow.id as number);
      podRow = { ...podRow, duplicate_flag: true };
    }
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
  res.status(201).json({ ...snakeToCamel(podRow), communityName });
});

router.post("/api/pod/:id/flag-exception", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager"), async (req, res) => {
  const podId = Number(req.params.id);
  const { notes } = req.body as { notes?: string };
  if (!Number.isInteger(podId) || podId <= 0) {
    res.status(400).json({ error: "Invalid PoD id" });
    return;
  }
  if (notes != null && typeof notes !== "string") {
    res.status(400).json({ error: "notes must be a string" });
    return;
  }
  if (!(await loadAuthorizedPod(req, podId))) {
    res.status(404).json({ error: "PoD not found" });
    return;
  }
  // Only an unprocessed delivery can enter exception review; this endpoint is
  // intentionally not a general-purpose status update.
  const { data, error } = await supa.from("pod")
    .update({ status: "Exception", ...(notes?.trim() ? { notes: notes.trim() } : {}) })
    .eq("id", podId)
    .eq("status", "Pending")
    .select()
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) {
    const { data: existing, error: lookupError } = await supa.from("pod").select("status").eq("id", podId).maybeSingle();
    if (lookupError) { res.status(500).json({ error: lookupError.message }); return; }
    res.status(existing ? 409 : 404).json({ error: existing ? "Only Pending PoDs can be flagged as exceptions" : "PoD not found" });
    return;
  }
  await logAudit(req, "FLAG_EXCEPTION", "PoD", `Flagged PoD ID ${podId} as an exception`, "pod", podId);
  res.json(snakeToCamel(data));
});

router.post("/api/pod/:id/override-face", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const podId = Number(req.params.id);
  const { reason } = req.body as { reason: string };
  if (!Number.isInteger(podId) || podId <= 0) {
    res.status(400).json({ error: "Invalid PoD id" });
    return;
  }
  if (!reason?.trim()) { res.status(400).json({ error: "reason is required" }); return; }
  if (!(await loadAuthorizedPod(req, podId))) {
    res.status(404).json({ error: "PoD not found" });
    return;
  }
  // Face evidence is only reviewable while the delivery is still pending.
  // Exceptions remain a separate management decision and terminal PoDs must
  // never have their verification evidence rewritten.
  const { data, error } = await supa.from("pod")
    .update({ face_status: "Override", override_reason: reason })
    .eq("id", podId)
    .eq("status", "Pending")
    .select()
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) {
    const { data: existing, error: lookupError } = await supa.from("pod").select("status").eq("id", podId).maybeSingle();
    if (lookupError) { res.status(500).json({ error: lookupError.message }); return; }
    res.status(existing ? 409 : 404).json({ error: existing ? "Only Pending PoDs can have face verification overridden" : "PoD not found" });
    return;
  }
  await logAudit(req, "OVERRIDE_FACE", "PoD", `Supervisor override face verification for PoD ID ${podId}: ${reason}`, "pod", (data as any).id);
  res.json(snakeToCamel(data));
});

router.post("/api/pod/:id/approve-exception", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "DistrictCoordinator"), async (req, res) => {
  const { notes } = req.body;
  const podId = Number(req.params.id);
  if (!Number.isInteger(podId) || podId <= 0) {
    res.status(400).json({ error: "Invalid PoD id" });
    return;
  }
  if (!(await loadAuthorizedPod(req, podId))) {
    res.status(404).json({ error: "PoD not found" });
    return;
  }
  const approvedBy = await resolveUserId(req);
  if (approvedBy === null || !Number.isInteger(approvedBy) || approvedBy <= 0) {
    res.status(403).json({ error: "Your account is not linked to an active operational user and cannot approve PoD exceptions" });
    return;
  }
  const { data, error } = await supa.rpc("approve_pod_exception_atomic", {
    p_pod_id: podId,
    p_approved_by: approvedBy,
    p_notes: notes ?? null,
  });
  if (error || !data) {
    const message = error?.message ?? "PoD approval failed";
    const status = /does not exist/i.test(message) ? 404
      : /already been processed|cannot approve deliveries from status|status:/i.test(message) ? 409
      : 400;
    res.status(status).json({ error: message });
    return;
  }
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
    const uniqueIds = [...new Set(ids.map(Number))];
    if (uniqueIds.some(id => !Number.isInteger(id) || id <= 0)) {
      res.status(400).json({ error: "ids must contain positive integers" });
      return;
    }
    const { data: targetPods } = await supa.from("pod")
      .select("id,status,campaign_id,dispatch_id,field_officer_id,duplicate_flag")
      .in("id", uniqueIds);
    if ((targetPods ?? []).length !== uniqueIds.length) {
      res.status(404).json({ error: "One or more PoDs were not found" });
      return;
    }
    const allowed = await Promise.all((targetPods ?? []).map(pod => canReadPod(req, pod)));
    if (allowed.some(value => !value)) {
      res.status(403).json({ error: "Forbidden", message: "One or more PoDs are outside your authorized scope" });
      return;
    }
    if ((targetPods ?? []).some((pod: any) => pod.duplicate_flag === true)) {
      res.status(409).json({ error: "Duplicate-flagged PoDs cannot be batch approved" });
      return;
    }

    const { data: approvedCount, error: approvalErr } = await supa.rpc("approve_pods_atomic", {
      p_pod_ids: uniqueIds,
      p_approved_by: userId,
    });
    if (approvalErr) {
      const alreadyProcessed = /already been processed|cannot approve deliveries from status|status:/i.test(approvalErr.message);
      res.status(alreadyProcessed ? 409 : 400).json({ error: approvalErr.message });
      return;
    }
    await logAudit(req, "APPROVE", "PoD", `Batch approved ${approvedCount ?? ids.length} PoD(s)`, "pod", ids[0]);
    res.json({ approved: approvedCount ?? ids.length });
    return;

    /* Replaced by approve_pods_atomic: keeping approval and every derived
       counter in the same database transaction is required for correctness.
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
      const dispPods = (pods ?? []).filter((p: any) => p.dispatch_id === did);

      // Collect items to process per pod: prefer pod_items, fall back to pod row fields
      const dispatchItemUpdates: { input_item_id: number; qty: number }[] = [];
      for (const p of dispPods as any[]) {
        const { data: podItemRows } = await supa
          .from("pod_items")
          .select("input_item_id, quantity_delivered")
          .eq("pod_id", p.id);
        if (podItemRows && podItemRows.length > 0) {
          for (const pi of podItemRows as any[]) {
            if (pi.input_item_id) dispatchItemUpdates.push({ input_item_id: pi.input_item_id, qty: Number(pi.quantity_delivered) });
          }
        } else if (p.input_item_id && p.quantity_delivered) {
          dispatchItemUpdates.push({ input_item_id: p.input_item_id, qty: Number(p.quantity_delivered) });
        }
      }

      for (const item of dispatchItemUpdates) {
        const { data: dispItem } = await supa
          .from("dispatch_items")
          .select("id, quantity_delivered")
          .eq("dispatch_id", did)
          .eq("input_item_id", item.input_item_id)
          .single();
        if (dispItem) {
          const newQty = ((dispItem as any).quantity_delivered ?? 0) + item.qty;
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
    */
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
      .select("farmer_id, campaign_id, dispatch_id, input_item_id, quantity_delivered, duplicate_flag")
      .eq("id", podId)
      .single();
    if (podErr || !pod) { res.status(404).json({ error: "PoD not found" }); return; }
    if (!(await canReadPod(req, pod))) { res.status(404).json({ error: "PoD not found" }); return; }
    const { farmer_id, campaign_id, dispatch_id, input_item_id, quantity_delivered, duplicate_flag } = pod as any;

    // Duplicate-flagged records are audit evidence and are never deliverable.
    if (duplicate_flag) {
      const { data: existingPods } = await supa
        .from("pod")
        .select("id, pod_code, submitted_at, status")
        .eq("farmer_id", farmer_id)
        .eq("campaign_id", campaign_id)
        .eq("status", "Verified")
        .neq("id", podId)
        .limit(1);
      res.status(409).json({
        error: "Duplicate delivery detected — this farmer has already received inputs in this campaign.",
        duplicate: true,
        existingPod: existingPods?.[0] ?? null,
      });
      return;
    }

    const { error: approvalErr } = await supa.rpc("approve_pods_atomic", {
      p_pod_ids: [podId],
      p_approved_by: userId,
    });
    if (approvalErr) {
      const alreadyProcessed = /already been processed|cannot approve deliveries from status|status:/i.test(approvalErr.message);
      res.status(alreadyProcessed ? 409 : 400).json({ error: approvalErr.message });
      return;
    }

    /* Replaced by approve_pods_atomic.
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
    if (dispatch_id) {
      // Prefer pod_items (multi-item PoD) over legacy single-item fields
      const { data: podItemRows } = await supa
        .from("pod_items")
        .select("input_item_id, quantity_delivered")
        .eq("pod_id", podId);

      const itemsToProcess = (podItemRows && podItemRows.length > 0)
        ? (podItemRows as any[]).map(pi => ({ input_item_id: pi.input_item_id, qty: Number(pi.quantity_delivered) }))
        : (input_item_id && quantity_delivered)
          ? [{ input_item_id, qty: Number(quantity_delivered) }]
          : [];

      for (const item of itemsToProcess) {
        if (!item.input_item_id) continue;
        const { data: dispItem } = await supa
          .from("dispatch_items")
          .select("id, quantity_delivered")
          .eq("dispatch_id", dispatch_id)
          .eq("input_item_id", item.input_item_id)
          .single();
        if (dispItem) {
          const newQty = ((dispItem as any).quantity_delivered ?? 0) + item.qty;
          await supa.from("dispatch_items")
            .update({ quantity_delivered: newQty })
            .eq("id", (dispItem as any).id);
        }
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
    */

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
        await sendSms(phone, `Dear ${name}, your delivery has been confirmed. Thank you. — AVDP PoD`);
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
  const { farmerId, dispatchId, photoIndex } = req.body as { farmerId?: number; dispatchId?: number; photoIndex?: number };
  if (!farmerId || !dispatchId) { res.status(400).json({ error: "farmerId and dispatchId are required" }); return; }
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
    res.status(403).json({ error: "Forbidden", message: "You may not upload evidence for this farmer and dispatch" });
    return;
  }
  const idx = Number.isFinite(Number(photoIndex)) ? Number(photoIndex) : 0;
  const key = `pods/${farmerId}/${Date.now()}-photo-${idx}.jpg`;
  try {
    const url = generateProxyUploadUrl(key, req);
    res.json({ uploadUrl: url, key, bucket });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
