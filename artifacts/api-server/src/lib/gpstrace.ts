import { supa } from "./supabase.js";
import { logger } from "./logger.js";

const API_BASE = "https://api.gps-trace.com";

function getProviderToken(): string {
  const token = process.env["GPS_TRACE_API_TOKEN"];
  if (!token) throw new Error("GPS_TRACE_API_TOKEN not configured.");
  return token;
}

function providerHeaders(): Record<string, string> {
  return { "accept": "application/json", "X-AccessToken": getProviderToken() };
}

const WIALON_HOST = (): string =>
  (process.env["GPS_TRACE_WIALON_HOST"] ?? "forguard.gurtam.space").replace(/\/$/, "");

function hasWialonToken(): boolean {
  return !!process.env["GPS_TRACE_WIALON_TOKEN"];
}

let _wialonSid: string | null = null;
let _wialonSidExpiry = 0;

async function wialonLogin(): Promise<string> {
  const now = Date.now();
  if (_wialonSid && now < _wialonSidExpiry) return _wialonSid;

  const token = process.env["GPS_TRACE_WIALON_TOKEN"]!;
  const host = WIALON_HOST();
  const params = encodeURIComponent(JSON.stringify({ token, fl: 1 }));
  const url = `https://${host}/wialon/ajax.html?svc=token%2Flogin&params=${params}`;

  const res = await fetch(url, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
    },
  });
  const text = await res.text();

  let data: any;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(`Wialon login: unexpected response from ${host}: ${text.slice(0, 200)}`); }

  if (data.error) throw new Error(`Wialon login error ${data.error}: ${data.reason ?? "unknown"}`);

  _wialonSid = data.eid as string;
  _wialonSidExpiry = now + 23 * 60 * 60 * 1000;
  logger.info({ host }, "Wialon session established");
  return _wialonSid;
}

async function wialonFetchUnitPositions(): Promise<Map<string, { lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date }>> {
  const sid = await wialonLogin();
  const host = WIALON_HOST();
  const spec = {
    itemsType: "avl_unit",
    propName: "sys_id",
    propValueMask: "*",
    sortType: "sys_name",
    propType: "property",
  };
  const params = encodeURIComponent(JSON.stringify({ spec, force: 1, flags: 1025, from: 0, count: 1000 }));
  const url = `https://${host}/wialon/ajax.html?sid=${sid}&svc=core%2Fsearch_items&params=${params}`;

  const res = await fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" } });
  const text = await res.text();

  let data: any;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(`Wialon search_items: unexpected response: ${text.slice(0, 200)}`); }

  if (data.error) {
    if (data.error === 1) {
      _wialonSid = null;
      return wialonFetchUnitPositions();
    }
    throw new Error(`Wialon search_items error ${data.error}`);
  }

  const result = new Map<string, { lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date }>();
  const items: any[] = data.items ?? [];
  for (const item of items) {
    const pos = item.pos;
    if (!pos || !pos.y || !pos.x) continue;
    result.set(String(item.id), {
      lat: Number(pos.y),
      lng: Number(pos.x),
      speed: pos.s != null ? Number(pos.s) : null,
      heading: pos.c != null ? Number(pos.c) : null,
      recordedAt: new Date(pos.t * 1000),
    });
  }
  return result;
}

export async function fetchAllTrackers(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/provider/units`, { headers: providerHeaders() });
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

async function fetchTrackerTelemetry(unitId: number): Promise<any> {
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/telemetry`, { headers: providerHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telemetry fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function fetchTrackerMessages(unitId: number, count = 1): Promise<any[]> {
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/messages?count=${count}`, { headers: providerHeaders() });
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

function extractPositionFromProviderData(telemetry: any, messages: any[]): {
  lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date
} | null {
  const tel = telemetry?.position ?? telemetry?.gps ?? telemetry?.data ?? telemetry;
  const lat = tel?.lat ?? tel?.latitude;
  const lng = tel?.lng ?? tel?.longitude ?? tel?.lon;
  if (lat != null && lng != null && lat !== 0 && lng !== 0) {
    return {
      lat: Number(lat), lng: Number(lng),
      speed: tel?.speed != null ? Number(tel.speed) : null,
      heading: tel?.heading ?? tel?.course != null ? Number(tel?.heading ?? tel?.course) : null,
      recordedAt: tel?.time ? new Date(tel.time) : new Date(),
    };
  }
  const msg = messages?.[0];
  if (!msg) return null;
  const mlat = msg?.lat ?? msg?.latitude ?? msg?.position?.lat;
  const mlng = msg?.lng ?? msg?.longitude ?? msg?.lon ?? msg?.position?.lng;
  if (mlat != null && mlng != null && mlat !== 0 && mlng !== 0) {
    return {
      lat: Number(mlat), lng: Number(mlng),
      speed: msg?.speed != null ? Number(msg.speed) : null,
      heading: msg?.heading ?? msg?.course != null ? Number(msg?.heading ?? msg?.course) : null,
      recordedAt: msg?.time ? new Date(msg.time) : new Date(),
    };
  }
  return null;
}

export async function syncAllVehicles(): Promise<{ synced: number; skipped: number; source: string }> {
  const { data: vehicles, error } = await supa
    .from("vehicles")
    .select("id, gps_device_id")
    .not("gps_device_id", "is", null)
    .neq("gps_device_id", "");

  if (error) {
    logger.error({ err: error.message }, "GPS sync: failed to fetch vehicles");
    return { synced: 0, skipped: 0, source: "error" };
  }

  const vList: { id: number; gps_device_id: string }[] = vehicles ?? [];
  if (!vList.length) return { synced: 0, skipped: 0, source: "none" };

  if (hasWialonToken()) {
    return syncViaWialon(vList);
  }

  logger.warn(
    { hint: "Set GPS_TRACE_WIALON_TOKEN from ForGuard UI: User → API Access → Generate token" },
    "GPS_TRACE_WIALON_TOKEN not set — falling back to Provider API (positions may be unavailable)"
  );
  return syncViaProviderApi(vList);
}

async function syncViaWialon(
  vehicles: { id: number; gps_device_id: string }[]
): Promise<{ synced: number; skipped: number; source: string }> {
  let synced = 0;
  let skipped = 0;

  try {
    const positions = await wialonFetchUnitPositions();
    logger.info({ unitCount: positions.size }, "Wialon positions fetched");

    for (const v of vehicles) {
      const pos = positions.get(v.gps_device_id);
      if (!pos) {
        logger.warn({ vehicleId: v.id, gpsDeviceId: v.gps_device_id }, "No Wialon position for unit");
        skipped++;
        continue;
      }
      await supa.from("gps_track").insert({
        vehicle_id:  v.id,
        dispatch_id: null,
        latitude:    pos.lat,
        longitude:   pos.lng,
        speed:       pos.speed,
        heading:     pos.heading,
        accuracy:    null,
        recorded_at: pos.recordedAt.toISOString(),
      });
      await supa.from("vehicles").update({
        last_latitude:  pos.lat,
        last_longitude: pos.lng,
        last_ping:      pos.recordedAt.toISOString(),
      }).eq("id", v.id);
      synced++;
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, "Wialon sync error");
    skipped += vehicles.length;
  }

  logger.info({ synced, skipped, source: "wialon" }, "GPS sync complete");
  return { synced, skipped, source: "wialon" };
}

async function syncViaProviderApi(
  vehicles: { id: number; gps_device_id: string }[]
): Promise<{ synced: number; skipped: number; source: string }> {
  let synced = 0;
  let skipped = 0;

  for (const v of vehicles) {
    const unitId = Number(v.gps_device_id);
    if (isNaN(unitId)) { skipped++; continue; }
    try {
      const [telemetry, telemetryErr] = await fetchTrackerTelemetry(unitId)
        .then(d => [d, null] as const)
        .catch(e => [null, e.message] as const);
      const [messages, messagesErr] = await fetchTrackerMessages(unitId, 1)
        .then(d => [d, null] as const)
        .catch(e => [[] as any[], e.message] as const);

      if (telemetryErr) logger.warn({ vehicleId: v.id, unitId, reason: telemetryErr }, "Provider API telemetry unavailable");
      if (messagesErr)  logger.warn({ vehicleId: v.id, unitId, reason: messagesErr },  "Provider API messages unavailable");

      const pos = extractPositionFromProviderData(telemetry, messages ?? []);
      if (!pos) {
        logger.warn(
          { vehicleId: v.id, unitId, hasTelemetry: !!telemetry, messageCount: (messages ?? []).length },
          "No position from Provider API — set GPS_TRACE_WIALON_TOKEN to enable live tracking"
        );
        skipped++;
        continue;
      }
      await supa.from("gps_track").insert({
        vehicle_id:  v.id,
        dispatch_id: null,
        latitude:    pos.lat,
        longitude:   pos.lng,
        speed:       pos.speed,
        heading:     pos.heading,
        accuracy:    null,
        recorded_at: pos.recordedAt.toISOString(),
      });
      await supa.from("vehicles").update({
        last_latitude:  pos.lat,
        last_longitude: pos.lng,
        last_ping:      pos.recordedAt.toISOString(),
      }).eq("id", v.id);
      synced++;
    } catch (err: any) {
      logger.warn({ vehicleId: v.id, unitId, err: err.message }, "Provider API sync error");
      skipped++;
    }
  }

  logger.info({ synced, skipped, source: "provider-api" }, "GPS sync complete");
  return { synced, skipped, source: "provider-api" };
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller(intervalMs = 30_000): void {
  if (_pollTimer) return;
  logger.info({ intervalMs, wialonEnabled: hasWialonToken() }, "Starting GPS poller");
  _pollTimer = setInterval(async () => {
    try { await syncAllVehicles(); }
    catch (err: any) { logger.warn({ err: err.message }, "GPS poller error"); }
  }, intervalMs);
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS initial sync error")
  );
}
