/**
 * GPS poller — Partner Console API (api.gps-trace.com, X-AccessToken).
 * Runs on a background interval; writes positions to gps_track + vehicles.
 */
import { supa } from "./supabase.js";
import { logger } from "./logger.js";

const API_BASE = "https://api.gps-trace.com";

const getToken = () =>
  (process.env["GPS_TRACE_TOKEN"] || process.env["GPS_TRACE_API_TOKEN"] || process.env["GPSTRACE_TOKEN"] || "").trim();

async function partnerGet(path: string): Promise<any> {
  const token = getToken();
  if (!token) throw new Error("GPS_TRACE_API_TOKEN is not set");
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

export async function syncAllVehicles(): Promise<{ synced: number; skipped: number; source: string }> {
  if (!getToken()) return { synced: 0, skipped: 0, source: "no-token" };

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

  // Build a map of deviceId → vehicle
  const deviceMap = new Map<string, typeof vList[number]>();
  for (const v of vList) deviceMap.set(v.gps_device_id, v);

  // Fetch telemetry in parallel for all linked devices
  const deviceIds = [...deviceMap.keys()];
  const telemetries = await Promise.allSettled(
    deviceIds.map(id => partnerGet(`/provider/units/${id}/telemetry`) as Promise<Telemetry>)
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
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS initial sync error")
  );
}
