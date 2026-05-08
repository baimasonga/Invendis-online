import { query } from "./db.js";
import { logger } from "./logger.js";

// GPS-Trace Provider API — uses X-AccessToken header (token from Partner Panel → Tokens tab)
// Note: /partner/* redirects to /provider/* — use /provider/ directly to avoid 301 overhead
// Docs: https://api.gps-trace.com
const API_BASE = "https://api.gps-trace.com";

function getToken(): string {
  const token = process.env["GPS_TRACE_API_TOKEN"];
  if (!token) throw new Error("GPS_TRACE_API_TOKEN not configured. Get it from GPS-Trace Partner Panel → Tokens tab.");
  return token;
}

function authHeaders(): Record<string, string> {
  return {
    "accept": "application/json",
    "X-AccessToken": getToken(),
  };
}

export async function fetchAllTrackers(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/provider/units`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GPS-Trace units fetch failed (${res.status}): ${body}`);
  }
  const json = await res.json() as any;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

export async function fetchTrackerTelemetry(unitId: number): Promise<any> {
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/telemetry`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telemetry fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchTrackerMessages(unitId: number, count = 1): Promise<any[]> {
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/messages?count=${count}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`messages fetch failed (${res.status}): ${body}`);
  }
  const json = await res.json() as any;
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.messages)) return json.messages;
  return [];
}

function extractPosition(telemetry: any, messages: any[]): { lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date } | null {
  // Try telemetry first (most recent position)
  const tel = telemetry?.position ?? telemetry?.gps ?? telemetry;
  const lat = tel?.lat ?? tel?.latitude;
  const lng = tel?.lng ?? tel?.longitude ?? tel?.lon;
  if (lat != null && lng != null && lat !== 0 && lng !== 0) {
    return {
      lat: Number(lat),
      lng: Number(lng),
      speed: tel?.speed != null ? Number(tel.speed) : null,
      heading: tel?.heading ?? tel?.course != null ? Number(tel?.heading ?? tel?.course) : null,
      recordedAt: tel?.time ? new Date(tel.time) : new Date(),
    };
  }
  // Fall back to latest message
  const msg = messages?.[0];
  if (!msg) return null;
  const mlat = msg?.lat ?? msg?.latitude ?? msg?.position?.lat;
  const mlng = msg?.lng ?? msg?.longitude ?? msg?.lon ?? msg?.position?.lng;
  if (mlat != null && mlng != null && mlat !== 0 && mlng !== 0) {
    return {
      lat: Number(mlat),
      lng: Number(mlng),
      speed: msg?.speed != null ? Number(msg.speed) : null,
      heading: msg?.heading ?? msg?.course != null ? Number(msg?.heading ?? msg?.course) : null,
      recordedAt: msg?.time ? new Date(msg.time) : new Date(),
    };
  }
  return null;
}

export async function syncAllVehicles(): Promise<{ synced: number; skipped: number }> {
  const vehiclesRes = await query(
    `SELECT id, gps_device_id FROM vehicles WHERE gps_device_id IS NOT NULL AND gps_device_id != ''`
  );
  const vehicles: { id: number; gps_device_id: string }[] = vehiclesRes.rows;

  if (!vehicles.length) return { synced: 0, skipped: 0 };

  let synced = 0;
  let skipped = 0;

  for (const v of vehicles) {
    const unitId = Number(v.gps_device_id);
    if (isNaN(unitId)) { skipped++; continue; }
    try {
      const [telemetry, messages] = await Promise.all([
        fetchTrackerTelemetry(unitId).catch(() => null),
        fetchTrackerMessages(unitId, 1).catch(() => []),
      ]);

      const pos = extractPosition(telemetry, messages);
      if (!pos) { skipped++; continue; }

      await query(
        `INSERT INTO gps_track (vehicle_id, dispatch_id, latitude, longitude, speed, heading, accuracy, recorded_at)
         VALUES ($1, NULL, $2, $3, $4, $5, NULL, $6)`,
        [v.id, pos.lat, pos.lng, pos.speed, pos.heading, pos.recordedAt]
      );
      await query(
        `UPDATE vehicles SET last_latitude=$1, last_longitude=$2, last_ping=$3 WHERE id=$4`,
        [pos.lat, pos.lng, pos.recordedAt, v.id]
      );
      synced++;
    } catch (err: any) {
      logger.warn({ vehicleId: v.id, unitId, err: err.message }, "GPS-Trace sync error");
      skipped++;
    }
  }

  logger.info({ synced, skipped }, "GPS-Trace sync complete");
  return { synced, skipped };
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller(intervalMs = 30_000): void {
  if (_pollTimer) return;
  logger.info({ intervalMs }, "Starting GPS-Trace background poller");
  _pollTimer = setInterval(async () => {
    try { await syncAllVehicles(); }
    catch (err: any) { logger.warn({ err: err.message }, "GPS-Trace poller error"); }
  }, intervalMs);
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS-Trace initial sync error")
  );
}
