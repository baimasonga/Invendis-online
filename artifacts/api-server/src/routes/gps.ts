import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { districtCoords, DISTRICT_GEOFENCE_RADIUS_M } from "../lib/district-coords.js";

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

// ── POST /api/gps/ping ────────────────────────────────────────────────────────
router.post("/api/gps/ping", requireAnyAuth, async (req, res) => {
  const { vehicleId: rawVehicleId, dispatchId: rawDispatchId, latitude: rawLat, longitude: rawLng, speed, heading, accuracy } = req.body;

  // Coerce + validate. The mobile app and hardware bridges have both been seen
  // sending numeric strings, so parse explicitly rather than relying on JS
  // coercion (which silently yields NaN for null/undefined and corrupts the
  // stored track + every distance computed from it).
  const vehicleId  = Number(rawVehicleId);
  const dispatchId = rawDispatchId != null ? Number(rawDispatchId) : null;
  const lat        = Number(rawLat);
  const lng        = Number(rawLng);

  if (!Number.isFinite(vehicleId) || vehicleId <= 0) {
    res.status(400).json({ error: "vehicleId is required" });
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "latitude and longitude must be numbers" });
    return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "latitude/longitude out of range" });
    return;
  }

  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : n;
  };

  const { error: trackErr } = await supa.from("gps_track").insert({
    vehicle_id:  vehicleId,
    dispatch_id: Number.isFinite(dispatchId as number) ? dispatchId : null,
    latitude:    lat,
    longitude:   lng,
    speed:       numOrNull(speed),
    heading:     numOrNull(heading),
    accuracy:    numOrNull(accuracy),
    recorded_at: new Date().toISOString(),
  });
  // Surface storage failures instead of reporting success on a dropped ping.
  if (trackErr) {
    console.error("GPS ping: failed to insert gps_track:", trackErr);
    res.status(500).json({ error: "Failed to record GPS position" });
    return;
  }

  const { error: vehErr } = await supa.from("vehicles")
    .update({ last_latitude: lat, last_longitude: lng, last_ping: new Date().toISOString() })
    .eq("id", vehicleId);
  if (vehErr) console.error("GPS ping: failed to update vehicle last position:", vehErr);

  let arrivalStatus: string | null = null;

  if (dispatchId) {
    const { data: dispRow } = await supa
      .from("dispatches")
      .select("id, status, arrived_at, campaign_id")
      .eq("id", dispatchId)
      .single();

    if (dispRow && dispRow.status === "In Transit" && !dispRow.arrived_at) {
      const { data: camp } = await supa
        .from("campaigns")
        .select("distribution_site_id, district_id")
        .eq("id", dispRow.campaign_id)
        .single();

      let destLat: number | null = null;
      let destLng: number | null = null;
      let geofenceRadius = 500;

      if (camp?.distribution_site_id) {
        const { data: site } = await supa
          .from("distribution_sites")
          .select("latitude, longitude, geofence_radius, district_id")
          .eq("id", camp.distribution_site_id)
          .single();
        destLat = site?.latitude ?? null;
        destLng = site?.longitude ?? null;
        geofenceRadius = site?.geofence_radius ?? 500;

        if (destLat == null || destLng == null) {
          const distId = site?.district_id ?? camp?.district_id ?? null;
          const dc = districtCoords(distId);
          if (dc) { destLat = destLat ?? dc.lat; destLng = destLng ?? dc.lng; }
        }
      } else if (camp?.district_id) {
        const dc = districtCoords(camp.district_id);
        if (dc) { destLat = dc.lat; destLng = dc.lng; geofenceRadius = DISTRICT_GEOFENCE_RADIUS_M; }
      }

      if (destLat != null && destLng != null) {
        const distM = haversineMeters(lat, lng, destLat, destLng);
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

// ── POST /api/gps/retranslator ───────────────────────────────────────────────
// Inbound webhook for hardware GPS trackers (GPS-Trace / Wialon retranslator).
// app.ts mounts express.raw() on this path, so req.body is a Buffer here.
//
// Devices are matched to a vehicle by vehicles.gps_device_id (set via
// /api/gpstrace/link). Accepts either a JSON body or a JSON array of positions.
// Auth: shared token via Authorization header (Bearer/Token) — devices that
// cannot set headers may pass ?token= instead.
router.post("/api/gps/retranslator", async (req, res) => {
  const expectedToken = (
    process.env.GPS_RETRANSLATOR_TOKEN ||
    process.env.GPS_TRACE_TOKEN ||
    process.env.GPS_TRACE_API_TOKEN ||
    process.env.GPSTRACE_TOKEN ||
    ""
  ).trim();

  if (!expectedToken) {
    console.error("GPS retranslator: no token configured — rejecting inbound position");
    res.status(503).json({ error: "Retranslator not configured" });
    return;
  }

  const authHeader = String(req.headers.authorization ?? "");
  const headerToken = authHeader.replace(/^(Bearer|Token)\s+/i, "").trim();
  const incomingToken = headerToken || String((req.query as any).token ?? "").trim();
  if (incomingToken !== expectedToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // req.body is a Buffer (express.raw). Fall back gracefully if json() ran first.
  let payload: any;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
    payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    res.status(400).json({ error: "Body must be JSON" });
    return;
  }

  const entries: any[] = Array.isArray(payload) ? payload : [payload];
  let accepted = 0;
  const skipped: string[] = [];

  for (const e of entries) {
    // Tolerate the various field spellings different retranslator profiles emit.
    const deviceId = String(e?.unitId ?? e?.unit_id ?? e?.deviceId ?? e?.device_id ?? e?.imei ?? "").trim();
    const lat = Number(e?.lat ?? e?.latitude ?? e?.y);
    const lng = Number(e?.lng ?? e?.lon ?? e?.longitude ?? e?.x);

    if (!deviceId)                                   { skipped.push("missing device id"); continue; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped.push(`${deviceId}: bad coordinates`); continue; }
    if (lat === 0 && lng === 0)                      { skipped.push(`${deviceId}: null island`); continue; }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) { skipped.push(`${deviceId}: out of range`); continue; }

    const { data: vehicle } = await supa
      .from("vehicles")
      .select("id")
      .eq("gps_device_id", deviceId)
      .limit(1)
      .maybeSingle();

    if (!vehicle) { skipped.push(`${deviceId}: not linked to a vehicle`); continue; }

    const vehicleId = (vehicle as any).id as number;

    // Attach the position to the vehicle's currently active dispatch, if any,
    // so the trip history and route replay are populated for hardware trackers.
    const { data: activeDispatch } = await supa
      .from("dispatches")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .eq("status", "In Transit")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const numOrNull = (v: unknown) => {
      const n = Number(v);
      return v == null || !Number.isFinite(n) ? null : n;
    };
    const recordedAt = e?.recordedAt ?? e?.recorded_at ?? e?.timestamp ?? e?.time;
    const recordedIso = (() => {
      if (recordedAt == null) return new Date().toISOString();
      // Unix seconds or ms, or an ISO string.
      const n = Number(recordedAt);
      if (Number.isFinite(n) && n > 0) return new Date(n > 1e12 ? n : n * 1000).toISOString();
      const d = new Date(String(recordedAt));
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    })();

    const { error: insErr } = await supa.from("gps_track").insert({
      vehicle_id:  vehicleId,
      dispatch_id: (activeDispatch as any)?.id ?? null,
      latitude:    lat,
      longitude:   lng,
      speed:       numOrNull(e?.speed),
      heading:     numOrNull(e?.heading ?? e?.course),
      accuracy:    numOrNull(e?.accuracy),
      recorded_at: recordedIso,
    });
    if (insErr) { console.error("GPS retranslator: insert failed:", insErr); skipped.push(`${deviceId}: store failed`); continue; }

    await supa.from("vehicles")
      .update({ last_latitude: lat, last_longitude: lng, last_ping: recordedIso })
      .eq("id", vehicleId);

    accepted++;
  }

  res.json({ success: true, accepted, skipped: skipped.length, details: skipped.slice(0, 20) });
});

// ── GET /api/gps/vehicles ─────────────────────────────────────────────────────
router.get("/api/gps/vehicles", requireAnyAuth, async (_req, res) => {
  // 1. Active dispatches
  const { data: dispatches, error: dispErr } = await supa
    .from("dispatches")
    .select("id, manifest_code, status, departed_at, arrived_at, vehicle_id, campaign_id, driver_id")
    .in("status", ["In Transit", "Arrived"]);

  if (dispErr) { res.status(500).json({ error: dispErr.message }); return; }
  const dispatchRows = dispatches ?? [];

  // 2. Live Tracking is vehicle-driven, not dispatch-driven. A vehicle earns a
  //    place on the map if it has a linked hardware tracker or a known position,
  //    even with no active dispatch — otherwise linking a tracker appears to do
  //    nothing, which is exactly how this looked before: trackers reporting
  //    positions minutes ago were invisible because their vehicle was idle.
  //    Filtering happens in JS rather than via a PostgREST .or(...) filter: the
  //    vehicle table is small, and this avoids depending on null-negation filter
  //    syntax that would fail silently and empty the map if it were wrong.
  const { data: allVehicles, error: trackedErr } = await supa
    .from("vehicles")
    .select("id, plate_number, vehicle_code, vehicle_type, gps_device_id, last_latitude, last_longitude, last_ping");
  if (trackedErr) console.error("GPS vehicles: vehicle lookup failed:", trackedErr);

  const trackedVehicles = (allVehicles ?? []).filter(
    (v: any) => v.gps_device_id != null || v.last_ping != null,
  );

  const dispatchVehicleIds = [...new Set(dispatchRows.map(d => d.vehicle_id).filter(Boolean))];
  const campaignIds        = [...new Set(dispatchRows.map(d => d.campaign_id).filter(Boolean))];
  const driverIds          = [...new Set(dispatchRows.map(d => d.driver_id).filter(Boolean))];

  // Any vehicle on an active dispatch also belongs here, even with no tracker and
  // no position yet — it should show as "no signal" rather than vanish.
  const trackedIds = new Set(trackedVehicles.map((v: any) => v.id));
  const dispatchOnlyVehicles = (allVehicles ?? []).filter(
    (v: any) => !trackedIds.has(v.id) && dispatchVehicleIds.includes(v.id),
  );

  const vehiclesRes = { data: [...trackedVehicles, ...dispatchOnlyVehicles] };
  if (vehiclesRes.data.length === 0) { res.json([]); return; }

  // 3. Parallel lookups for dispatch enrichment
  const [campaignsRes, driversRes] = await Promise.all([
    campaignIds.length > 0
      ? supa.from("campaigns").select("id, name, distribution_site_id, district_id").in("id", campaignIds)
      : Promise.resolve({ data: [] }),
    driverIds.length > 0
      ? supa.from("drivers").select("id, full_name").in("id", driverIds)
      : Promise.resolve({ data: [] }),
  ]);

  // Most relevant active dispatch per vehicle: In Transit outranks Arrived, then
  // most recently departed/created.
  const dispatchByVehicle: Record<number, any> = {};
  for (const d of dispatchRows) {
    if (!d.vehicle_id) continue;
    const cur = dispatchByVehicle[d.vehicle_id];
    if (!cur) { dispatchByVehicle[d.vehicle_id] = d; continue; }
    const rank = (x: any) => (x.status === "In Transit" ? 1 : 0);
    if (rank(d) !== rank(cur)) {
      if (rank(d) > rank(cur)) dispatchByVehicle[d.vehicle_id] = d;
      continue;
    }
    const t = (x: any) => new Date(x.departed_at ?? x.arrived_at ?? 0).getTime();
    if (t(d) > t(cur)) dispatchByVehicle[d.vehicle_id] = d;
  }

  const campaignMap: Record<number, any> = {};
  const driverMap:   Record<number, any> = {};
  for (const c of campaignsRes.data ?? []) campaignMap[c.id] = c;
  for (const d of driversRes.data   ?? []) driverMap[d.id]   = d;

  // 4. Collect site IDs and district IDs
  const siteIds = [...new Set(
    (campaignsRes.data ?? []).map((c: any) => c.distribution_site_id).filter(Boolean)
  )];

  const { data: sites } = siteIds.length > 0
    ? await supa.from("distribution_sites").select("id, name, latitude, longitude, geofence_radius, district_id").in("id", siteIds)
    : { data: [] };

  const siteMap: Record<number, any> = {};
  for (const s of sites ?? []) siteMap[s.id] = s;

  // 5. Collect all district IDs (from sites + campaign fallback)
  const districtIds = [...new Set([
    ...(sites ?? []).map((s: any) => s.district_id).filter(Boolean),
    ...(campaignsRes.data ?? []).map((c: any) => c.district_id).filter(Boolean),
  ])];

  // NOTE: the districts table has no latitude/longitude columns — selecting them
  // makes PostgREST reject the whole query (42703), which previously left every
  // district-level destination unresolved (no distance, no geofence, no label).
  // District centroids come from the same districtCoords() lookup the ping route
  // uses, so both paths agree on where a district-level destination is.
  const { data: districts, error: districtErr } = districtIds.length > 0
    ? await supa.from("districts").select("id, name").in("id", districtIds)
    : { data: [], error: null };
  if (districtErr) console.error("GPS vehicles: district lookup failed:", districtErr);

  const districtMap: Record<number, any> = {};
  for (const d of districts ?? []) {
    const dc = districtCoords(d.id);
    districtMap[d.id] = { ...d, latitude: dc?.lat ?? null, longitude: dc?.lng ?? null };
  }

  // 6. Assemble rows — one per vehicle, enriched with its active dispatch if any
  const rows = vehiclesRes.data
    .map((vehicle: any) => {
      const d        = dispatchByVehicle[vehicle.id] ?? null;
      const campaign = d?.campaign_id ? campaignMap[d.campaign_id] : null;
      const driver   = d?.driver_id ? driverMap[d.driver_id] : null;
      const site     = campaign?.distribution_site_id ? siteMap[campaign.distribution_site_id] : null;

      const districtId = site?.district_id ?? campaign?.district_id ?? null;
      const district   = districtId ? districtMap[districtId] : null;

      const destLat: number | null = site?.latitude  ?? district?.latitude  ?? null;
      const destLng: number | null = site?.longitude ?? district?.longitude ?? null;
      // Match the ping route: a district centroid is a much coarser target than a
      // configured site, so it gets the wider district radius.
      const usingDistrictFallback = site?.latitude == null || site?.longitude == null;
      const geofenceRadius: number = usingDistrictFallback
        ? DISTRICT_GEOFENCE_RADIUS_M
        : (site?.geofence_radius ?? 500);

      let distanceToDestM: number | null = null;
      let distanceLabel:   string | null = null;
      let withinGeofence:  boolean | null = null;

      if (vehicle?.last_latitude != null && vehicle?.last_longitude != null && destLat != null && destLng != null) {
        const distM = haversineMeters(vehicle.last_latitude, vehicle.last_longitude, destLat, destLng);
        distanceToDestM = Math.round(distM);
        distanceLabel   = formatDistance(distM);
        withinGeofence  = distM <= geofenceRadius;
      }

      return {
        id:               vehicle?.id ?? null,
        plateNumber:      vehicle?.plate_number ?? null,
        vehicleCode:      vehicle?.vehicle_code ?? null,
        vehicleType:      vehicle?.vehicle_type ?? null,
        lastLatitude:     vehicle?.last_latitude ?? null,
        lastLongitude:    vehicle?.last_longitude ?? null,
        lastPing:         vehicle?.last_ping ?? null,
        // A tracker linked to an idle vehicle is legitimate — these are null and
        // the UI already renders that case (manifest/campaign are conditional).
        hasTracker:       vehicle?.gps_device_id != null,
        hasActiveDispatch: d != null,
        dispatchId:       d?.id ?? null,
        manifestCode:     d?.manifest_code ?? null,
        dispatchStatus:   d?.status ?? null,
        departedAt:       d?.departed_at ?? null,
        arrivedAt:        d?.arrived_at ?? null,
        campaignName:     campaign?.name ?? null,
        destinationName:  site?.name ?? null,
        districtName:     district?.name ?? null,
        driverName:       driver?.full_name ?? null,
        effectiveDestLat: destLat,
        effectiveDestLng: destLng,
        destinationLabel: site?.name ?? (district?.name ? `${district.name} District` : null),
        hasDestination:   destLat != null && destLng != null,
        distanceToDestM,
        distanceLabel,
        withinGeofence,
      };
    })
    .filter(r => r.id != null)
    .sort((a, b) => {
      if (!a.lastPing && !b.lastPing) return 0;
      if (!a.lastPing) return 1;
      if (!b.lastPing) return -1;
      return new Date(b.lastPing).getTime() - new Date(a.lastPing).getTime();
    });

  res.json(rows);
});

// ── GET /api/gps/track/:vehicleId ────────────────────────────────────────────
router.get("/api/gps/track/:vehicleId", requireAnyAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? "100"), 500);
  const { data, error } = await supa
    .from("gps_track")
    .select("id, latitude, longitude, speed, heading, accuracy, recorded_at")
    .eq("vehicle_id", Number(req.params.vehicleId))
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(
    (data ?? []).map((r: any) => ({
      id:         r.id,
      latitude:   r.latitude,
      longitude:  r.longitude,
      speed:      r.speed,
      heading:    r.heading,
      accuracy:   r.accuracy,
      recordedAt: r.recorded_at,
    }))
  );
});

// ── GET /api/gps/history/:vehicleId ──────────────────────────────────────────
// Past dispatches for a vehicle, with the distance actually travelled on each.
// The web portal calls this (listGpsVehicleHistory) — it previously 404'd.
router.get("/api/gps/history/:vehicleId", requireAnyAuth, async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isFinite(vehicleId) || vehicleId <= 0) {
    res.status(400).json({ error: "Invalid vehicleId" });
    return;
  }
  const limit = Math.min(Number(req.query.limit ?? "20"), 100);

  const { data: dispatches, error } = await supa
    .from("dispatches")
    .select("id, manifest_code, status, campaign_id, departed_at, arrived_at, created_at")
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("GPS history: dispatch lookup failed:", error);
    res.status(500).json({ error: "Failed to load vehicle history" });
    return;
  }

  const rows = dispatches ?? [];
  if (rows.length === 0) { res.json([]); return; }

  const campaignIds = [...new Set(rows.map((d: any) => d.campaign_id).filter(Boolean))];
  const { data: campaigns } = campaignIds.length > 0
    ? await supa.from("campaigns").select("id, name").in("id", campaignIds)
    : { data: [] };
  const campaignMap: Record<number, any> = {};
  for (const c of campaigns ?? []) campaignMap[c.id] = c;

  // Track points for these dispatches, so each trip can report its real distance.
  const dispatchIds = rows.map((d: any) => d.id);
  const { data: points } = await supa
    .from("gps_track")
    .select("dispatch_id, latitude, longitude, recorded_at")
    .in("dispatch_id", dispatchIds)
    .order("recorded_at", { ascending: true });

  const pointsByDispatch: Record<number, any[]> = {};
  for (const p of points ?? []) {
    const did = (p as any).dispatch_id;
    if (did == null) continue;
    (pointsByDispatch[did] ??= []).push(p);
  }

  res.json(rows.map((d: any) => {
    const pts = pointsByDispatch[d.id] ?? [];
    let distanceM = 0;
    for (let i = 1; i < pts.length; i++) {
      distanceM += haversineMeters(
        pts[i - 1].latitude, pts[i - 1].longitude,
        pts[i].latitude,     pts[i].longitude,
      );
    }
    const durationMs = d.departed_at && d.arrived_at
      ? new Date(d.arrived_at).getTime() - new Date(d.departed_at).getTime()
      : null;

    return {
      dispatchId:     d.id,
      manifestCode:   d.manifest_code,
      status:         d.status,
      campaignName:   campaignMap[d.campaign_id]?.name ?? null,
      departedAt:     d.departed_at,
      arrivedAt:      d.arrived_at,
      createdAt:      d.created_at,
      pointCount:     pts.length,
      distanceM:      Math.round(distanceM),
      distanceLabel:  formatDistance(distanceM),
      durationMinutes: durationMs != null ? Math.round(durationMs / 60000) : null,
    };
  }));
});

export default router;
