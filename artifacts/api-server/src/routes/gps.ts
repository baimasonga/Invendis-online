import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { supa, snakeToCamel } from "../lib/supabase.js";
import { fetchAllTrackers, syncAllVehicles } from "../lib/gpstrace.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

router.post("/api/gps/ping", requireAnyAuth, async (req, res) => {
  const { vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy } = req.body;
  if (!vehicleId || latitude == null || longitude == null) {
    res.status(400).json({ error: "vehicleId, latitude, and longitude are required" }); return;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "Invalid latitude or longitude" }); return;
  }

  try {
    await Promise.all([
      supa.from("gps_track").insert({
        vehicle_id: vehicleId, dispatch_id: dispatchId ?? null,
        latitude: lat, longitude: lng,
        speed: speed ?? null, heading: heading ?? null, accuracy: accuracy ?? null,
        recorded_at: new Date().toISOString(),
      }),
      supa.from("vehicles").update({
        last_latitude: lat, last_longitude: lng, last_ping: new Date().toISOString(),
      }).eq("id", vehicleId),
    ]);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to save GPS ping" }); return;
  }

  let arrivalStatus: string | null = null;

  if (dispatchId) {
    const { data: disp } = await supa
      .from("dispatches")
      .select("id, status, arrived_at, campaign_id")
      .eq("id", dispatchId)
      .single();

    const d = disp as any;
    if (d && d.status === "In Transit" && !d.arrived_at && d.campaign_id) {
      const { data: camp } = await supa
        .from("campaigns")
        .select("distribution_site_id, district_id")
        .eq("id", d.campaign_id)
        .single();

      const c = camp as any;
      let destLat: number | null = null;
      let destLng: number | null = null;
      let geofenceRadius = 500;

      if (c?.distribution_site_id) {
        const { data: site } = await supa
          .from("distribution_sites")
          .select("latitude, longitude, geofence_radius")
          .eq("id", c.distribution_site_id)
          .single();
        destLat = (site as any)?.latitude ?? null;
        destLng = (site as any)?.longitude ?? null;
        geofenceRadius = (site as any)?.geofence_radius ?? 500;
      }

      if ((destLat == null || destLng == null) && c?.district_id) {
        const { data: dc } = await supa
          .from("districts")
          .select("latitude, longitude")
          .eq("id", c.district_id)
          .single();
        destLat = (dc as any)?.latitude ?? null;
        destLng = (dc as any)?.longitude ?? null;
        geofenceRadius = 500;
      }

      if (destLat != null && destLng != null) {
        const distM = haversineMeters(latitude, longitude, destLat, destLng);
        if (distM <= geofenceRadius) {
          await supa
            .from("dispatches")
            .update({ arrived_at: new Date().toISOString(), status: "Arrived", updated_at: new Date().toISOString() })
            .eq("id", dispatchId)
            .is("arrived_at", null);
          arrivalStatus = "arrived";
        }
      }
    }
  }

  res.json({ success: true, arrivalStatus });
});

router.get("/api/gps/vehicles", requireAnyAuth, async (_req, res) => {
  const { data: vehicles, error } = await supa
    .from("vehicles")
    .select("id, plate_number, vehicle_code, vehicle_type, last_latitude, last_longitude, last_ping, status, gps_device_id")
    .eq("status", "InTransit")
    .not("gps_device_id", "is", null)
    .neq("gps_device_id", "")
    .order("last_ping", { ascending: false, nullsFirst: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  const vList = vehicles ?? [];
  if (!vList.length) { res.json([]); return; }

  const vehicleIds = vList.map((v: any) => v.id);

  const { data: activeDispatches } = await supa
    .from("dispatches")
    .select("id, vehicle_id, manifest_code, status, departed_at, arrived_at, campaign_id, driver_id, warehouse_id")
    .in("vehicle_id", vehicleIds)
    .in("status", ["In Transit", "Arrived"]);

  const dispatchList = activeDispatches ?? [];
  const campaignIds   = [...new Set(dispatchList.map((d: any) => d.campaign_id).filter(Boolean))];
  const driverIds     = [...new Set(dispatchList.map((d: any) => d.driver_id).filter(Boolean))];
  const warehouseIds  = [...new Set(dispatchList.map((d: any) => d.warehouse_id).filter(Boolean))];

  const [{ data: campaigns }, { data: drivers }, { data: warehouses }] = await Promise.all([
    campaignIds.length  ? supa.from("campaigns").select("id, name, distribution_site_id, district_id").in("id", campaignIds) : Promise.resolve({ data: [] }),
    driverIds.length    ? supa.from("drivers").select("id, full_name").in("id", driverIds) : Promise.resolve({ data: [] }),
    warehouseIds.length ? supa.from("warehouses").select("id, name").in("id", warehouseIds) : Promise.resolve({ data: [] }),
  ]);

  const siteIds    = [...new Set((campaigns ?? []).map((c: any) => c.distribution_site_id).filter(Boolean))];
  const districtIds = [...new Set((campaigns ?? []).map((c: any) => c.district_id).filter(Boolean))];

  const [{ data: sites }, { data: districts }] = await Promise.all([
    siteIds.length    ? supa.from("distribution_sites").select("id, name, latitude, longitude, geofence_radius").in("id", siteIds) : Promise.resolve({ data: [] }),
    districtIds.length ? supa.from("districts").select("id, name, latitude, longitude").in("id", districtIds) : Promise.resolve({ data: [] }),
  ]);

  const dispMap      = Object.fromEntries(dispatchList.map((d: any) => [d.vehicle_id, d]));
  const campMap      = Object.fromEntries((campaigns ?? []).map((c: any) => [c.id, c]));
  const driverMap    = Object.fromEntries((drivers ?? []).map((d: any) => [d.id, d]));
  const siteMap      = Object.fromEntries((sites ?? []).map((s: any) => [s.id, s]));
  const distMap      = Object.fromEntries((districts ?? []).map((d: any) => [d.id, d]));
  const warehouseMap = Object.fromEntries((warehouses ?? []).map((w: any) => [w.id, w]));

  const rows = vList.map((v: any) => {
    const dispatch   = dispMap[v.id] as any;
    const campaign   = dispatch?.campaign_id   ? campMap[dispatch.campaign_id]   as any : null;
    const driver     = dispatch?.driver_id     ? driverMap[dispatch.driver_id]   as any : null;
    const warehouse  = dispatch?.warehouse_id  ? warehouseMap[dispatch.warehouse_id] as any : null;
    const site       = campaign?.distribution_site_id ? siteMap[campaign.distribution_site_id] as any : null;
    const district   = campaign?.district_id  ? distMap[campaign.district_id]  as any : null;

    const destLat: number | null = site?.latitude    ?? district?.latitude    ?? null;
    const destLng: number | null = site?.longitude   ?? district?.longitude   ?? null;
    const geofenceRadius: number = site?.geofence_radius ?? 500;
    const destinationLabel = site?.name ?? (district ? `${district.name} District` : null);
    const hasDestination   = destLat != null && destLng != null;

    let distanceToDestM: number | null = null;
    let distanceLabel: string | null = null;
    let withinGeofence: boolean | null = null;

    if (v.last_latitude != null && v.last_longitude != null && hasDestination) {
      const distM = haversineMeters(v.last_latitude, v.last_longitude, destLat!, destLng!);
      distanceToDestM = Math.round(distM);
      distanceLabel   = formatDistance(distM);
      withinGeofence  = distM <= geofenceRadius;
    }

    return {
      id:               v.id,
      plateNumber:      v.plate_number,
      vehicleCode:      v.vehicle_code,
      vehicleType:      v.vehicle_type,
      lastLatitude:     v.last_latitude,
      lastLongitude:    v.last_longitude,
      lastPing:         v.last_ping,
      dispatchId:       dispatch?.id           ?? null,
      manifestCode:     dispatch?.manifest_code ?? null,
      dispatchStatus:   dispatch?.status        ?? null,
      departedAt:       dispatch?.departed_at   ?? null,
      arrivedAt:        dispatch?.arrived_at    ?? null,
      campaignName:     campaign?.name          ?? null,
      destinationName:  site?.name              ?? null,
      effectiveDestLat: destLat,
      effectiveDestLng: destLng,
      destinationLabel,
      hasDestination,
      districtName:     district?.name          ?? null,
      driverName:       driver?.full_name        ?? null,
      warehouseName:    warehouse?.name          ?? null,
      distanceToDestM,
      distanceLabel,
      withinGeofence,
    };
  });

  res.json(rows);
});

router.get("/api/gps/track/:vehicleId", requireAnyAuth, async (req, res) => {
  const { limit = "100" } = req.query as Record<string, string>;
  const { data, error } = await supa
    .from("gps_track")
    .select("*")
    .eq("vehicle_id", Number(req.params.vehicleId))
    .order("recorded_at", { ascending: false })
    .limit(Number(limit));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel((data ?? []).reverse()));
});

router.get("/api/gps/trace/units", requireAnyAuth, async (_req, res) => {
  try {
    const trackers = await fetchAllTrackers();
    res.json(trackers.map((t: any) => ({
      id: t.id, label: t.name ?? t.label ?? `Unit #${t.id}`,
      deviceType: t.device_type_id, ident: t.ident, enabled: t.enabled,
      lastActive: t.last_active, status: t.last_active ? "active" : "registered",
    })));
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/api/gps/trace/link", requireAnyAuth, async (req, res) => {
  const { vehicleId, unitId, unitLabel } = req.body as { vehicleId: number; unitId: string; unitLabel?: string };
  if (!vehicleId || !unitId) { res.status(400).json({ error: "vehicleId and unitId are required" }); return; }
  const { data: vehicle } = await supa.from("vehicles").select("plate_number, vehicle_code").eq("id", vehicleId).single();
  await supa.from("vehicles").update({ gps_device_id: String(unitId) }).eq("id", vehicleId);
  await logAudit(req, "LINK", "GPS",
    `GPS tracker ${unitLabel ?? `Unit #${unitId}`} linked to vehicle ${(vehicle as any)?.plate_number ?? vehicleId}`,
    "Vehicle", vehicleId,
    { unitId, unitLabel, plateNumber: (vehicle as any)?.plate_number, vehicleCode: (vehicle as any)?.vehicle_code }
  );
  res.json({ success: true });
});

router.post("/api/gps/trace/unlink", requireAnyAuth, async (req, res) => {
  const { vehicleId } = req.body as { vehicleId: number };
  if (!vehicleId) { res.status(400).json({ error: "vehicleId required" }); return; }
  const { data: vehicle } = await supa.from("vehicles").select("plate_number, vehicle_code, gps_device_id").eq("id", vehicleId).single();
  await supa.from("vehicles").update({ gps_device_id: null }).eq("id", vehicleId);
  await logAudit(req, "UNLINK", "GPS",
    `GPS tracker unlinked from vehicle ${(vehicle as any)?.plate_number ?? vehicleId}`,
    "Vehicle", vehicleId,
    { previousUnitId: (vehicle as any)?.gps_device_id, plateNumber: (vehicle as any)?.plate_number }
  );
  res.json({ success: true });
});

router.post("/api/gps/trace/sync", requireAnyAuth, async (_req, res) => {
  try {
    const result = await syncAllVehicles();
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/api/gps/retranslator", async (req, res) => {
  const expectedToken = process.env["GPS_TRACE_API_TOKEN"]?.trim();
  if (!expectedToken) {
    req.log.error({}, "GPS retranslator: GPS_TRACE_API_TOKEN not set — all pushes rejected");
    res.status(503).json({ error: "retranslator not configured" });
    return;
  }

  const authHeader = (req.headers["authorization"] ?? "") as string;
  const incomingToken =
    authHeader.startsWith("Bearer ") ? authHeader.slice(7) :
    authHeader.startsWith("Token ")  ? authHeader.slice(6) :
    authHeader || (req.query["token"] as string) || "";

  if (incomingToken !== expectedToken) {
    req.log.warn({ hasAuthHeader: !!authHeader, hasQueryToken: !!(req.query["token"]) }, "GPS retranslator: unauthorized push rejected");
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let rawBody: Buffer | null = null;
  let jsonBody: any = null;

  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
    try { jsonBody = JSON.parse(rawBody.toString("utf8")); } catch (_) { /* binary */ }
  } else if (typeof req.body === "object" && req.body !== null) {
    jsonBody = req.body;
  } else if (typeof req.body === "string") {
    try { jsonBody = JSON.parse(req.body); } catch (_) { /* noop */ }
  }

  req.log.info({
    contentType: req.headers["content-type"],
    bodySize: rawBody?.length ?? JSON.stringify(jsonBody ?? "").length,
    isJson: jsonBody !== null,
    rawHex: rawBody ? rawBody.slice(0, 64).toString("hex") : undefined,
    jsonSample: jsonBody ? JSON.stringify(jsonBody).slice(0, 400) : undefined,
  }, "GPS retranslator push received");

  const positions: Array<{ unitId: string; lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date }> = [];

  const tryExtract = (obj: any): void => {
    if (!obj) return;
    const unitId = String(obj.unit_id ?? obj.unitId ?? obj.id ?? obj.device_id ?? obj.imei ?? "");
    const lat = Number(obj.lat ?? obj.latitude ?? obj.y ?? obj.gps?.lat);
    const lng = Number(obj.lon ?? obj.lng ?? obj.longitude ?? obj.x ?? obj.gps?.lon);
    if (!unitId || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;
    const speed = obj.speed != null ? Number(obj.speed) : null;
    const heading = obj.course ?? obj.heading ?? obj.direction;
    const ts = obj.dt ?? obj.ts ?? obj.timestamp ?? obj.time;
    const recordedAt = ts ? new Date(typeof ts === "number" ? ts * 1000 : ts) : new Date();
    positions.push({ unitId, lat, lng, speed, heading: heading != null ? Number(heading) : null, recordedAt });
  };

  if (Array.isArray(jsonBody)) jsonBody.forEach(tryExtract);
  else if (jsonBody) {
    tryExtract(jsonBody);
    if (Array.isArray(jsonBody.data))      jsonBody.data.forEach(tryExtract);
    if (Array.isArray(jsonBody.positions)) jsonBody.positions.forEach(tryExtract);
    if (Array.isArray(jsonBody.messages))  jsonBody.messages.forEach(tryExtract);
  }

  if (!positions.length && rawBody && rawBody.length > 8) {
    try {
      for (let i = 0; i <= rawBody.length - 8; i++) {
        const lat = rawBody.readFloatBE(i);
        const lng = rawBody.readFloatBE(i + 4);
        if (lat >= 6.9 && lat <= 9.9 && lng >= -13.3 && lng <= -10.3) {
          const speed   = i + 10 <= rawBody.length ? rawBody.readUInt16BE(i + 8)  : null;
          const heading = i + 12 <= rawBody.length ? rawBody.readUInt16BE(i + 10) : null;
          req.log.info({ lat, lng, speed, heading, byteOffset: i }, "GPS retranslator: sutran binary coordinates found");
          const { data: vRow } = await supa.from("vehicles").select("gps_device_id").not("gps_device_id", "is", null).neq("gps_device_id", "").limit(1).single();
          const unitId = (vRow as any)?.gps_device_id ?? "";
          if (unitId) positions.push({ unitId, lat, lng, speed: speed ?? null, heading: heading ? heading % 360 : null, recordedAt: new Date() });
          break;
        }
      }
    } catch (binaryErr: any) {
      req.log.warn({ err: binaryErr.message }, "GPS retranslator: binary parse error");
    }
  }

  let saved = 0;
  for (const pos of positions) {
    const { data: vRow } = await supa.from("vehicles").select("id").eq("gps_device_id", pos.unitId).single();
    if (!vRow) {
      req.log.warn({ unitId: pos.unitId }, "GPS retranslator: no vehicle linked — skipping");
      continue;
    }
    const vehicleId = (vRow as any).id;
    await supa.from("gps_track").insert({
      vehicle_id: vehicleId, dispatch_id: null,
      latitude: pos.lat, longitude: pos.lng,
      speed: pos.speed, heading: pos.heading, accuracy: null,
      recorded_at: pos.recordedAt.toISOString(),
    });
    await supa.from("vehicles").update({
      last_latitude: pos.lat, last_longitude: pos.lng, last_ping: pos.recordedAt.toISOString(),
    }).eq("id", vehicleId);
    req.log.info({ vehicleId, unitId: pos.unitId, lat: pos.lat, lng: pos.lng }, "GPS retranslator: position saved");
    saved++;
  }

  res.json({ received: true, positionsParsed: positions.length, saved });
});

router.get("/api/gps/trace/debug", requireAnyAuth, async (_req, res) => {
  const token = process.env["GPS_TRACE_API_TOKEN"] ?? "";
  const { data: vehiclesData } = await supa.from("vehicles").select("id, plate_number, gps_device_id").not("gps_device_id", "is", null).neq("gps_device_id", "");

  const [retranslators, retranslatorsErr] = await fetch(
    `https://api.gps-trace.com/provider/retranslators`,
    { headers: { "X-AccessToken": token } }
  ).then(async r => [await r.json(), null] as const).catch(e => [null, e.message] as const);

  const unitResults = await Promise.all((vehiclesData ?? []).map(async (v: any) => {
    const unitId = Number(v.gps_device_id);
    const unitDetail = await fetch(
      `https://api.gps-trace.com/provider/units/${unitId}`,
      { headers: { "X-AccessToken": token, accept: "application/json" } }
    ).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
      .catch(e => ({ status: 0, error: e.message }));
    return { vehicleId: v.id, plateNumber: v.plate_number, unitId, unitDetail };
  }));

  res.json({
    retranslators: retranslatorsErr ?? retranslators,
    retranslatorWebhookUrl: "https://invendisapp.com/api/gps/retranslator",
    retranslatorInstruction: "In GPS-Trace Partner Console → Extended Services → Retranslators → Edit → set target URL to the webhook URL above",
    vehicles: unitResults,
  });
});

router.get("/api/gps/trace/status", requireAnyAuth, async (_req, res) => {
  const { data, error } = await supa.from("vehicles").select("id, vehicle_code, plate_number, gps_device_id, last_ping, last_latitude, last_longitude").order("plate_number");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(snakeToCamel(data ?? []));
});

export default router;
