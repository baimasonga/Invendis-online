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
  const { vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy } = req.body;

  await supa.from("gps_track").insert({
    vehicle_id:  vehicleId,
    dispatch_id: dispatchId ?? null,
    latitude,
    longitude,
    speed:       speed    ?? null,
    heading:     heading  ?? null,
    accuracy:    accuracy ?? null,
    recorded_at: new Date().toISOString(),
  });

  await supa.from("vehicles")
    .update({ last_latitude: latitude, last_longitude: longitude, last_ping: new Date().toISOString() })
    .eq("id", vehicleId);

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

// ── GET /api/gps/vehicles ─────────────────────────────────────────────────────
router.get("/api/gps/vehicles", requireAnyAuth, async (_req, res) => {
  // 1. Active dispatches
  const { data: dispatches, error: dispErr } = await supa
    .from("dispatches")
    .select("id, manifest_code, status, departed_at, arrived_at, vehicle_id, campaign_id, driver_id")
    .in("status", ["In Transit", "Arrived"]);

  if (dispErr) { res.status(500).json({ error: dispErr.message }); return; }
  if (!dispatches || dispatches.length === 0) { res.json([]); return; }

  // 2. Collect IDs
  const vehicleIds  = [...new Set(dispatches.map(d => d.vehicle_id).filter(Boolean))];
  const campaignIds = [...new Set(dispatches.map(d => d.campaign_id).filter(Boolean))];
  const driverIds   = [...new Set(dispatches.map(d => d.driver_id).filter(Boolean))];

  // 3. Parallel lookups
  const [vehiclesRes, campaignsRes, driversRes] = await Promise.all([
    supa.from("vehicles").select("id, plate_number, vehicle_code, vehicle_type, last_latitude, last_longitude, last_ping").in("id", vehicleIds),
    supa.from("campaigns").select("id, name, distribution_site_id, district_id").in("id", campaignIds),
    driverIds.length > 0
      ? supa.from("drivers").select("id, full_name").in("id", driverIds)
      : Promise.resolve({ data: [] }),
  ]);

  const vehicleMap:  Record<number, any> = {};
  const campaignMap: Record<number, any> = {};
  const driverMap:   Record<number, any> = {};
  for (const v of vehiclesRes.data  ?? []) vehicleMap[v.id]  = v;
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

  const { data: districts } = districtIds.length > 0
    ? await supa.from("districts").select("id, name, latitude, longitude").in("id", districtIds)
    : { data: [] };

  const districtMap: Record<number, any> = {};
  for (const d of districts ?? []) districtMap[d.id] = d;

  // 6. Assemble rows
  const rows = dispatches
    .map(d => {
      const vehicle  = vehicleMap[d.vehicle_id];
      const campaign = campaignMap[d.campaign_id];
      const driver   = d.driver_id ? driverMap[d.driver_id] : null;
      const site     = campaign?.distribution_site_id ? siteMap[campaign.distribution_site_id] : null;

      const districtId = site?.district_id ?? campaign?.district_id ?? null;
      const district   = districtId ? districtMap[districtId] : null;

      const destLat: number | null = site?.latitude  ?? district?.latitude  ?? null;
      const destLng: number | null = site?.longitude ?? district?.longitude ?? null;
      const geofenceRadius: number = site?.geofence_radius ?? 500;

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
        dispatchId:       d.id,
        manifestCode:     d.manifest_code,
        dispatchStatus:   d.status,
        departedAt:       d.departed_at,
        arrivedAt:        d.arrived_at,
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

export default router;
