/**
 * GPS-Trace Partner Console integration
 *
 * Uses the GPS-Trace Partner REST API at https://api.gps-trace.com
 * Authentication: X-AccessToken header with the API token from
 *   partner.gps-trace.com → API Tokens
 *
 * Required env var:
 *   GPS_TRACE_API_TOKEN  – token from partner.gps-trace.com/api/tokens
 */
import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";

const router = Router();

const API_BASE = "https://api.gps-trace.com";

// Primary token — main fleet account
const getToken  = () =>
  (process.env.GPS_TRACE_TOKEN || process.env.GPS_TRACE_API_TOKEN || process.env.GPSTRACE_TOKEN || "").trim();

// Secondary token — distributor devices (GPS_TRACE_API_TOKEN_2)
const getToken2 = () =>
  (process.env.GPS_TRACE_API_TOKEN_2 || "").trim();

// ── Partner API helpers ───────────────────────────────────────────────────────

async function apiGet(token: string, path: string): Promise<any> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "X-AccessToken": token, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GPS-Trace API error ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function partnerGet(path: string): Promise<any> {
  const token = getToken();
  if (!token) throw new Error("GPS_TRACE_API_TOKEN is not set");
  return apiGet(token, path);
}

interface PartnerUnit {
  id: number;
  name: string;
  description?: string;
  last_active?: number | null;
  created_at?: number;
}

interface Telemetry {
  "position.latitude"?: { ts: number; value: number };
  "position.longitude"?: { ts: number; value: number };
  "position.speed"?: { ts: number; value: number };
  "position.direction"?: { ts: number; value: number };
  "position.altitude"?: { ts: number; value: number };
  "position.valid"?: { ts: number; value: boolean };
  "server.timestamp"?: { ts: number; value: number };
  timestamp?: { ts: number; value: number };
}

// Tagged unit: deviceId is prefixed "t2-<id>" for secondary-token units to avoid collisions
interface TaggedUnit extends PartnerUnit {
  deviceId: string;
  token: string;
}

async function fetchAllUnits(): Promise<TaggedUnit[]> {
  const t1 = getToken();
  const t2 = getToken2();

  const [r1, r2] = await Promise.allSettled([
    t1 ? apiGet(t1, "/provider/units") as Promise<PartnerUnit[]> : Promise.resolve([] as PartnerUnit[]),
    t2 ? apiGet(t2, "/provider/units") as Promise<PartnerUnit[]> : Promise.resolve([] as PartnerUnit[]),
  ]);

  const units1: TaggedUnit[] = (r1.status === "fulfilled" ? r1.value : [])
    .map(u => ({ ...u, deviceId: String(u.id), token: t1 }));
  const units2: TaggedUnit[] = (r2.status === "fulfilled" ? r2.value : [])
    .map(u => ({ ...u, deviceId: `t2-${u.id}`, token: t2 }));

  return [...units1, ...units2];
}

async function fetchTelemetry(unit: TaggedUnit): Promise<Telemetry> {
  return apiGet(unit.token, `/provider/units/${unit.id}/telemetry`);
}

// Legacy single-token helpers (used by sync route)
async function fetchUnits(): Promise<PartnerUnit[]> {
  return partnerGet("/provider/units");
}

// ── 45-second server-side cache for devices (prevents rate-limit hammering) ───
let _devicesCache: { ts: number; payload: object } | null = null;
const DEVICES_TTL_MS = 45_000;

function invalidateDevicesCache() { _devicesCache = null; }

// ── GET /api/gpstrace/devices ─────────────────────────────────────────────────
router.get("/api/gpstrace/devices", requireAnyAuth, async (_req, res) => {
  if (!getToken()) {
    res.json({ configured: false, devices: [], vehicles: [] });
    return;
  }

  // Serve from cache if fresh
  if (_devicesCache && Date.now() - _devicesCache.ts < DEVICES_TTL_MS) {
    res.json(_devicesCache.payload);
    return;
  }

  try {
    const units = await fetchAllUnits();

    const { data: vehicles } = await supa
      .from("vehicles")
      .select("id, plate_number, vehicle_type, vehicle_code, gps_device_id, last_ping");

    const vehicleMap: Record<string, any> = {};
    for (const v of vehicles ?? []) {
      if (v.gps_device_id) vehicleMap[v.gps_device_id] = v;
    }

    // Fetch telemetry for each unit in parallel (each unit carries its own token)
    const telemetries = await Promise.allSettled(
      units.map(u => fetchTelemetry(u))
    );

    const devices = units.map((u, i) => {
      const tel: Telemetry =
        telemetries[i].status === "fulfilled" ? telemetries[i].value : {};

      const lat = tel["position.latitude"]?.value ?? null;
      const lng = tel["position.longitude"]?.value ?? null;
      const ts  = tel["position.latitude"]?.ts ?? tel["timestamp"]?.value ?? null;

      return {
        deviceId:      u.deviceId,
        deviceName:    u.name,
        lastSeen:      ts ? new Date(ts * 1000).toISOString() : null,
        latitude:      lat,
        longitude:     lng,
        speed:         tel["position.speed"]?.value ?? null,
        heading:       tel["position.direction"]?.value ?? null,
        linkedVehicle: vehicleMap[u.deviceId] ?? null,
      };
    });

    const payload = { configured: true, devices, vehicles: vehicles ?? [] };
    _devicesCache = { ts: Date.now(), payload };
    res.json(payload);
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace unavailable" });
  }
});

// ── POST /api/gpstrace/sync ───────────────────────────────────────────────────
router.post("/api/gpstrace/sync", requireAnyAuth, async (_req, res) => {
  if (!getToken()) {
    res.json({ synced: 0, message: "GPS_TRACE_API_TOKEN not configured" });
    return;
  }

  try {
    const units = await fetchUnits();

    const { data: vehicles } = await supa
      .from("vehicles")
      .select("id, gps_device_id, last_ping")
      .not("gps_device_id", "is", null);

    const linkedVehicles = new Map<string, { id: number; lastPing: string | null }>();
    for (const v of vehicles ?? []) {
      if (v.gps_device_id) linkedVehicles.set(v.gps_device_id, { id: v.id, lastPing: v.last_ping });
    }

    let synced = 0;

    for (const unit of units) {
      const vehicle = linkedVehicles.get(String(unit.id));
      if (!vehicle) continue;

      let tel: Telemetry;
      try {
        tel = await fetchTelemetry(unit.id);
      } catch {
        continue;
      }

      const lat = tel["position.latitude"]?.value;
      const lng = tel["position.longitude"]?.value;
      const ts  = tel["position.latitude"]?.ts;

      if (lat == null || lng == null || ts == null) continue;

      const posTime = new Date(ts * 1000);

      if (vehicle.lastPing && posTime <= new Date(vehicle.lastPing)) continue;

      await supa.from("gps_track").insert({
        vehicle_id:  vehicle.id,
        dispatch_id: null,
        latitude:    lat,
        longitude:   lng,
        speed:       tel["position.speed"]?.value ?? null,
        heading:     tel["position.direction"]?.value ?? null,
        accuracy:    null,
        recorded_at: posTime.toISOString(),
      });

      await supa.from("vehicles").update({
        last_latitude:  lat,
        last_longitude: lng,
        last_ping:      posTime.toISOString(),
      }).eq("id", vehicle.id);

      synced++;
    }

    res.json({ synced, total: units.length, linked: linkedVehicles.size });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace sync failed" });
  }
});

// ── POST /api/gpstrace/link ───────────────────────────────────────────────────
router.post("/api/gpstrace/link", requireAnyAuth, async (req, res) => {
  const { vehicleId, deviceId, deviceName } = req.body as {
    vehicleId: number; deviceId: string; deviceName?: string;
  };
  if (!vehicleId || !deviceId) {
    res.status(400).json({ error: "vehicleId and deviceId are required" });
    return;
  }

  await supa.from("vehicles").update({ gps_device_id: null }).eq("gps_device_id", deviceId);

  const { error } = await supa
    .from("vehicles")
    .update({ gps_device_id: deviceId })
    .eq("id", vehicleId);

  if (error) { res.status(500).json({ error: error.message }); return; }

  invalidateDevicesCache();
  res.json({ success: true, vehicleId, deviceId, deviceName });
});

// ── DELETE /api/gpstrace/unlink/:vehicleId ────────────────────────────────────
router.delete("/api/gpstrace/unlink/:vehicleId", requireAnyAuth, async (req, res) => {
  const { error } = await supa
    .from("vehicles")
    .update({ gps_device_id: null })
    .eq("id", Number(req.params.vehicleId));

  if (error) { res.status(500).json({ error: error.message }); return; }
  invalidateDevicesCache();
  res.json({ success: true });
});

export default router;
