import { createHash } from "crypto";
import { supa } from "./supabase.js";
import { logger } from "./logger.js";

const API_BASE = "https://api.gps-trace.com";

function getProviderTokens(): string[] {
  const tokens: string[] = [];
  for (let i = 0; i <= 9; i++) {
    const key = i === 0 ? "GPS_TRACE_API_TOKEN" : `GPS_TRACE_API_TOKEN_${i}`;
    const val = process.env[key]?.trim();
    if (val && !tokens.includes(val)) tokens.push(val);
  }
  if (!tokens.length) throw new Error("No GPS_TRACE_API_TOKEN configured.");
  return tokens;
}

function providerHeaders(token?: string): Record<string, string> {
  const t = token ?? getProviderTokens()[0];
  return { "accept": "application/json", "X-AccessToken": t };
}

const WIALON_HOST = (): string =>
  (process.env["GPS_TRACE_WIALON_HOST"] ?? "forguard.gurtam.space").replace(/\/$/, "");

function hasWialonToken(): boolean {
  return !!process.env["GPS_TRACE_WIALON_TOKEN"];
}

function hasWialonCredentials(): boolean {
  return !!(process.env["GPS_TRACE_EMAIL"] && process.env["GPS_TRACE_PASSWORD"]);
}

export function canUseWialon(): boolean {
  return hasWialonToken() || hasWialonCredentials();
}

let _wialonSid: string | null = null;
let _wialonSidExpiry = 0;

async function wialonLoginViaToken(host: string): Promise<string> {
  const token = process.env["GPS_TRACE_WIALON_TOKEN"]!;
  const params = encodeURIComponent(JSON.stringify({ token, fl: 1 }));
  const url = `https://${host}/wialon/ajax.html?svc=token%2Flogin&params=${params}`;
  const res = await fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" } });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(`Wialon token/login: unexpected response: ${text.slice(0, 200)}`); }
  if (data.error) throw new Error(`Wialon token/login error ${data.error}: ${data.reason ?? "unknown"}`);
  return data.eid as string;
}

async function wialonLoginViaCredentials(host: string): Promise<string> {
  const email = process.env["GPS_TRACE_EMAIL"]!;
  const password = process.env["GPS_TRACE_PASSWORD"]!;
  const md5 = createHash("md5").update(password).digest("hex");

  const params = encodeURIComponent(JSON.stringify({ user: email, password: md5, checkService: 1 }));
  const url = `https://${host}/wialon/ajax.html?svc=core%2Flogin&params=${params}`;
  const res = await fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" } });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch (_) { throw new Error(`Wialon core/login: unexpected response: ${text.slice(0, 200)}`); }
  if (data.error) {
    if (data.error === 4) {
      const paramsPlain = encodeURIComponent(JSON.stringify({ user: email, password, checkService: 1 }));
      const url2 = `https://${host}/wialon/ajax.html?svc=core%2Flogin&params=${paramsPlain}`;
      const res2 = await fetch(url2, { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json" } });
      const text2 = await res2.text();
      let data2: any;
      try { data2 = JSON.parse(text2); }
      catch (_) { throw new Error(`Wialon core/login (plain): unexpected response: ${text2.slice(0, 200)}`); }
      if (data2.error) throw new Error(`Wialon core/login error ${data2.error}: ${data2.reason ?? "unknown"}`);
      return data2.eid as string;
    }
    throw new Error(`Wialon core/login error ${data.error}: ${data.reason ?? "unknown"}`);
  }
  return data.eid as string;
}

async function wialonLogin(): Promise<string> {
  const now = Date.now();
  if (_wialonSid && now < _wialonSidExpiry) return _wialonSid;

  const host = WIALON_HOST();
  let sid: string;
  let method: string;

  if (hasWialonToken()) {
    sid = await wialonLoginViaToken(host);
    method = "token";
  } else if (hasWialonCredentials()) {
    sid = await wialonLoginViaCredentials(host);
    method = "credentials";
  } else {
    throw new Error("No Wialon credentials configured. Set GPS_TRACE_WIALON_TOKEN or GPS_TRACE_EMAIL + GPS_TRACE_PASSWORD.");
  }

  _wialonSid = sid;
  _wialonSidExpiry = now + 23 * 60 * 60 * 1000;
  logger.info({ host, method }, "Wialon session established");
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

async function fetchUnitsForToken(token: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/provider/units`, { headers: providerHeaders(token) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GPS-Trace units fetch failed (${res.status}): ${body}`);
  }
  const json = await res.json() as any;
  const items: any[] = Array.isArray(json) ? json : (json.items ?? json.data ?? []);
  return items.map(u => ({ ...u, _token: token }));
}

export async function fetchAllTrackers(): Promise<any[]> {
  const tokens = getProviderTokens();
  const results = await Promise.allSettled(tokens.map(t => fetchUnitsForToken(t)));
  const seen = new Set<number>();
  const merged: any[] = [];
  for (const r of results) {
    if (r.status === "rejected") {
      logger.warn({ err: r.reason?.message }, "GPS-Trace: failed to fetch units from one account");
      continue;
    }
    for (const unit of r.value) {
      if (!seen.has(unit.id)) {
        seen.add(unit.id);
        merged.push(unit);
      }
    }
  }
  return merged;
}

// Map from unitId → the token that owns it (populated by fetchAllTrackers or lazily)
const _unitTokenCache = new Map<number, string>();

async function resolveTokenForUnit(unitId: number): Promise<string> {
  if (_unitTokenCache.has(unitId)) return _unitTokenCache.get(unitId)!;
  const tokens = getProviderTokens();
  if (tokens.length === 1) return tokens[0];
  // Try to discover which account owns this unit
  const units = await fetchAllTrackers();
  for (const u of units) {
    if (u._token) _unitTokenCache.set(Number(u.id), u._token);
  }
  return _unitTokenCache.get(unitId) ?? tokens[0];
}

async function fetchTrackerTelemetry(unitId: number): Promise<any> {
  const token = await resolveTokenForUnit(unitId);
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/telemetry`, { headers: providerHeaders(token) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`telemetry fetch failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function fetchTrackerMessages(unitId: number, count = 1): Promise<any[]> {
  const token = await resolveTokenForUnit(unitId);
  const res = await fetch(`${API_BASE}/provider/units/${unitId}/messages?count=${count}`, { headers: providerHeaders(token) });
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
  // GPS-Trace telemetry: { "position": { "ts": unix, "value": { latitude, longitude, speed, direction } } }
  const posEntry = telemetry?.["position"];
  if (posEntry?.value?.latitude != null && posEntry?.value?.longitude != null) {
    const v = posEntry.value;
    const ts = posEntry.ts ?? telemetry?.["timestamp"]?.value;
    return {
      lat: Number(v.latitude),
      lng: Number(v.longitude),
      speed: v.speed != null ? Number(v.speed) : null,
      heading: v.direction != null ? Number(v.direction) : null,
      recordedAt: ts ? new Date(Number(ts) * 1000) : new Date(),
    };
  }

  // Flat dot-notation telemetry fallback: "position.latitude", "position.longitude"
  const flatLat = telemetry?.["position.latitude"]?.value ?? telemetry?.["position.latitude"];
  const flatLng = telemetry?.["position.longitude"]?.value ?? telemetry?.["position.longitude"];
  if (flatLat != null && flatLng != null && flatLat !== 0 && flatLng !== 0) {
    const ts = telemetry?.["timestamp"]?.value ?? telemetry?.["timestamp"];
    return {
      lat: Number(flatLat),
      lng: Number(flatLng),
      speed: telemetry?.["position.speed"]?.value != null ? Number(telemetry["position.speed"].value) : null,
      heading: telemetry?.["position.direction"]?.value != null ? Number(telemetry["position.direction"].value) : null,
      recordedAt: ts ? new Date(Number(ts) * 1000) : new Date(),
    };
  }

  // GPS-Trace messages: flat object with "position.latitude", "position.longitude" as string keys
  const msg = messages?.[0];
  if (!msg) return null;
  const mlat = msg?.["position.latitude"] ?? msg?.lat ?? msg?.latitude ?? msg?.position?.lat ?? msg?.position?.latitude;
  const mlng = msg?.["position.longitude"] ?? msg?.lng ?? msg?.longitude ?? msg?.lon ?? msg?.position?.lng ?? msg?.position?.longitude;
  if (mlat != null && mlng != null && mlat !== 0 && mlng !== 0) {
    const ts = msg?.timestamp ?? msg?.["server.timestamp"] ?? msg?.time;
    return {
      lat: Number(mlat),
      lng: Number(mlng),
      speed: msg?.["position.speed"] != null ? Number(msg["position.speed"]) : (msg?.speed != null ? Number(msg.speed) : null),
      heading: msg?.["position.direction"] != null ? Number(msg["position.direction"]) : (msg?.heading ?? msg?.course != null ? Number(msg?.heading ?? msg?.course) : null),
      recordedAt: ts ? new Date(Number(ts) * 1000) : new Date(),
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

  if (canUseWialon()) {
    try {
      return await syncViaWialon(vList);
    } catch (err: any) {
      logger.debug({ err: err.message }, "Wialon sync failed — falling back to Provider API");
    }
  }

  return syncViaProviderApi(vList);
}

async function syncViaWialon(
  vehicles: { id: number; gps_device_id: string }[]
): Promise<{ synced: number; skipped: number; source: string }> {
  let synced = 0;
  let skipped = 0;

  // Let login/fetch errors propagate so syncAllVehicles can fall back to provider API
  const positions = await wialonFetchUnitPositions();
  logger.info({ unitCount: positions.size }, "Wialon positions fetched");

  for (const v of vehicles) {
    const pos = positions.get(v.gps_device_id);
    if (!pos) {
      logger.warn({ vehicleId: v.id, gpsDeviceId: v.gps_device_id }, "No Wialon position for unit");
      skipped++;
      continue;
    }
    try {
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
    } catch (dbErr: any) {
      logger.warn({ vehicleId: v.id, err: dbErr.message }, "Wialon: DB write error for vehicle");
      skipped++;
    }
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

export interface TrackerLivePosition {
  id: number;
  label: string;
  ident: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  recordedAt: string | null;
  enabled: boolean;
}

export async function fetchAllLivePositions(): Promise<TrackerLivePosition[]> {
  const trackers = await fetchAllTrackers();
  const results = await Promise.allSettled(
    trackers.map(async (t): Promise<TrackerLivePosition> => {
      let pos: { lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date } | null = null;
      try {
        const [telRes, msgRes] = await Promise.allSettled([
          fetchTrackerTelemetry(t.id),
          fetchTrackerMessages(t.id, 1),
        ]);
        pos = extractPositionFromProviderData(
          telRes.status === "fulfilled" ? telRes.value : null,
          msgRes.status === "fulfilled" ? msgRes.value : [],
        );
      } catch { /* no position available */ }
      return {
        id: Number(t.id),
        label: (t.name ?? t.label ?? `Unit #${t.id}`) as string,
        ident: (t.ident ?? null) as string | null,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        speed: pos?.speed ?? null,
        heading: pos?.heading ?? null,
        recordedAt: pos?.recordedAt?.toISOString() ?? null,
        enabled: t.enabled ?? true,
      };
    })
  );
  return results
    .filter((r): r is PromiseFulfilledResult<TrackerLivePosition> => r.status === "fulfilled")
    .map(r => r.value);
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller(intervalMs = 30_000): void {
  if (_pollTimer) return;
  logger.info({ intervalMs, wialonEnabled: canUseWialon(), method: hasWialonToken() ? "token" : hasWialonCredentials() ? "credentials" : "provider-api" }, "Starting GPS poller");
  _pollTimer = setInterval(async () => {
    try { await syncAllVehicles(); }
    catch (err: any) { logger.warn({ err: err.message }, "GPS poller error"); }
  }, intervalMs);
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS initial sync error")
  );
}
