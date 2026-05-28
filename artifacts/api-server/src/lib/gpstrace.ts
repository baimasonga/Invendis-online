/**
 * GPS poller — Partner Console API (api.gps-trace.com, X-AccessToken).
 * Runs on a background interval; writes positions to gps_track + vehicles.
 * Also checks auto-arrival: marks In Transit dispatches as Arrived when
 * the vehicle enters the campaign's geofence.
 *
 * Device IDs in the DB:
 *   "<number>"    → primary account  (GPS_TRACE_API_TOKEN)
 *   "t2-<number>" → secondary account (GPS_TRACE_API_TOKEN_2)
 */
import { supa } from "./supabase.js";
import { logger } from "./logger.js";
import { districtCoords, DISTRICT_GEOFENCE_RADIUS_M } from "./district-coords.js";

const API_BASE = "https://api.gps-trace.com";

const getToken  = () =>
  (process.env["GPS_TRACE_TOKEN"] || process.env["GPS_TRACE_API_TOKEN"] || process.env["GPSTRACE_TOKEN"] || "").trim();

const getToken2 = () =>
  (process.env["GPS_TRACE_API_TOKEN_2"] || "").trim();

/** Pick the right token + numeric unit ID for a stored deviceId. */
function resolveDevice(deviceId: string): { token: string; unitId: string } {
  if (deviceId.startsWith("t2-")) {
    return { token: getToken2(), unitId: deviceId.slice(3) };
  }
  return { token: getToken(), unitId: deviceId };
}

async function apiGet(token: string, path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "X-AccessToken": token, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GPS-Trace API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

interface Telemetry {
  "position.latitude"?:  { ts: number; value: number };
  "position.longitude"?: { ts: number; value: number };
  "position.speed"?:     { ts: number; value: number };
  "position.direction"?: { ts: number; value: number };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * After a vehicle position is updated, check whether any of its In Transit
 * dispatches have entered the campaign geofence — and mark them Arrived.
 */
async function checkArrival(vehicleId: number, lat: number, lng: number): Promise<void> {
  const { data: dispatches } = await supa
    .from("dispatches")
    .select("id, campaign_id")
    .eq("vehicle_id", vehicleId)
    .eq("status", "In Transit")
    .is("arrived_at", null);

  if (!dispatches || dispatches.length === 0) return;

  for (const dispatch of dispatches as { id: number; campaign_id: number }[]) {
    const { data: camp } = await supa
      .from("campaigns")
      .select("distribution_site_id, district_id")
      .eq("id", dispatch.campaign_id)
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
      destLat = (site as any)?.latitude ?? null;
      destLng = (site as any)?.longitude ?? null;
      geofenceRadius = (site as any)?.geofence_radius ?? 500;

      if (destLat == null || destLng == null) {
        const distId = (site as any)?.district_id ?? camp?.district_id ?? null;
        const dc = districtCoords(distId);
        if (dc) { destLat = dc.lat; destLng = dc.lng; geofenceRadius = DISTRICT_GEOFENCE_RADIUS_M; }
      }
    } else if (camp?.district_id) {
      const dc = districtCoords(camp.district_id);
      if (dc) { destLat = dc.lat; destLng = dc.lng; geofenceRadius = DISTRICT_GEOFENCE_RADIUS_M; }
    }

    if (destLat == null || destLng == null) continue;

    const distM = haversineMeters(lat, lng, destLat, destLng);
    if (distM <= geofenceRadius) {
      await supa
        .from("dispatches")
        .update({
          status:     "Arrived",
          arrived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", dispatch.id)
        .is("arrived_at", null);
      logger.info(
        { dispatchId: dispatch.id, vehicleId, distM: Math.round(distM), geofenceRadius },
        "GPS poller: dispatch auto-arrived"
      );
    }
  }
}

export async function syncAllVehicles(): Promise<{ synced: number; skipped: number; source: string }> {
  const t1 = getToken();
  const t2 = getToken2();
  if (!t1 && !t2) return { synced: 0, skipped: 0, source: "no-token" };

  const { data: vehicles, error } = await supa
    .from("vehicles")
    .select("id, gps_device_id, last_ping")
    .not("gps_device_id", "is", null)
    .neq("gps_device_id", "");

  if (error) {
    logger.error({ err: error.message }, "GPS sync: failed to fetch vehicles");
    return { synced: 0, skipped: 0, source: "error" };
  }

  const vList = (vehicles ?? []) as { id: number; gps_device_id: string; last_ping: string | null }[];
  if (!vList.length) return { synced: 0, skipped: 0, source: "none" };

  const deviceMap = new Map<string, typeof vList[number]>();
  for (const v of vList) deviceMap.set(v.gps_device_id, v);

  const deviceIds = [...deviceMap.keys()];
  const telemetries = await Promise.allSettled(
    deviceIds.map(deviceId => {
      const { token, unitId } = resolveDevice(deviceId);
      if (!token) return Promise.reject(new Error("no token for device"));
      return apiGet(token, `/provider/units/${unitId}/telemetry`) as Promise<Telemetry>;
    })
  );

  let synced = 0;
  let skipped = 0;

  for (let i = 0; i < deviceIds.length; i++) {
    const vehicle = deviceMap.get(deviceIds[i])!;
    const result = telemetries[i];

    if (result.status === "rejected") { skipped++; continue; }

    const tel = result.value;
    const lat = tel["position.latitude"]?.value  ?? null;
    const lng = tel["position.longitude"]?.value ?? null;
    const ts  = tel["position.latitude"]?.ts     ?? null;

    if (lat == null || lng == null || ts == null) { skipped++; continue; }

    const posTime = new Date(ts * 1000);
    if (vehicle.last_ping && posTime <= new Date(vehicle.last_ping)) { skipped++; continue; }

    const { error: insertErr } = await supa.from("gps_track").insert({
      vehicle_id:  vehicle.id,
      dispatch_id: null,
      latitude:    lat,
      longitude:   lng,
      speed:       tel["position.speed"]?.value     ?? null,
      heading:     tel["position.direction"]?.value ?? null,
      accuracy:    null,
      recorded_at: posTime.toISOString(),
    });

    if (insertErr) {
      logger.warn({ vehicleId: vehicle.id, err: insertErr.message }, "GPS poller: gps_track insert error");
      skipped++;
      continue;
    }

    await supa.from("vehicles").update({
      last_latitude:  lat,
      last_longitude: lng,
      last_ping:      posTime.toISOString(),
    }).eq("id", vehicle.id);

    // Check auto-arrival for any In Transit dispatches on this vehicle
    checkArrival(vehicle.id, lat, lng).catch((err: any) =>
      logger.warn({ vehicleId: vehicle.id, err: err.message }, "GPS poller: arrival check error")
    );

    synced++;
  }

  logger.info({ synced, skipped, source: "gpstrace-partner" }, "GPS sync complete");
  return { synced, skipped, source: "gpstrace-partner" };
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller(intervalMs = 30_000): void {
  if (_pollTimer) return;
  logger.info({ intervalMs }, "Starting GPS poller (Partner Console API)");
  _pollTimer = setInterval(async () => {
    try { await syncAllVehicles(); }
    catch (err: any) { logger.warn({ err: err.message }, "GPS poller error"); }
  }, intervalMs);
  // Run immediately on startup
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS initial sync error")
  );
}
