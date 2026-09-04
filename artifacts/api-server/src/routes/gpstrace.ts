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
import { requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { logAudit } from "../lib/audit.js";
import type { Request } from "express";

const router = Router();
const GPS_MANAGEMENT_ROLES = new Set(["admin", "projectmanager", "warehousemanager"]);

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

/** Pick the right token + numeric unit ID from a stored deviceId. */
function resolveDevice(deviceId: string): { token: string; unitId: string } {
  if (deviceId.startsWith("t2-")) {
    return { token: getToken2(), unitId: deviceId.slice(3) };
  }
  return { token: getToken(), unitId: deviceId };
}

// Legacy single-token helpers (used internally)
async function fetchUnits(): Promise<PartnerUnit[]> {
  return partnerGet("/provider/units");
}

// ── 45-second server-side cache for devices (prevents rate-limit hammering) ───
let _devicesCache: { ts: number; payload: { configured: boolean; devices: any[]; vehicles: any[] } } | null = null;
const DEVICES_TTL_MS = 45_000;

function invalidateDevicesCache() { _devicesCache = null; }

async function getVisibleGpsVehicleIds(req: Request): Promise<Set<number> | null> {
  const role = (req.user?.role ?? req.supabaseUser?.role ?? "").toLowerCase();
  if (GPS_MANAGEMENT_ROLES.has(role)) return null;

  let userId = req.user?.userId ?? null;
  let districtId = req.user?.districtId ?? null;
  if (req.supabaseUser?.email) {
    const { data: user } = await supa
      .from("users")
      .select("id,district_id")
      .eq("email", req.supabaseUser.email)
      .maybeSingle();
    userId = (user as any)?.id ?? null;
    districtId = (user as any)?.district_id ?? null;
  }

  const { data: dispatches } = await supa
    .from("dispatches")
    .select("vehicle_id,field_officer_id,campaign_id")
    .in("status", ["In Transit", "Arrived"]);
  let visibleDispatches = dispatches ?? [];

  if (role === "fieldofficer") {
    visibleDispatches = userId == null
      ? []
      : visibleDispatches.filter((d: any) => d.field_officer_id === userId);
  } else {
    if (districtId == null) return new Set();
    const campaignIds = [...new Set(visibleDispatches.map((d: any) => d.campaign_id).filter(Boolean))];
    if (!campaignIds.length) return new Set();
    const { data: campaigns } = await supa
      .from("campaigns")
      .select("id")
      .in("id", campaignIds)
      .eq("district_id", districtId);
    const allowedCampaignIds = new Set((campaigns ?? []).map((c: any) => c.id));
    visibleDispatches = visibleDispatches.filter((d: any) => allowedCampaignIds.has(d.campaign_id));
  }

  return new Set(visibleDispatches.map((d: any) => d.vehicle_id).filter(Boolean));
}

async function scopeDevicesPayload(req: Request, payload: { configured: boolean; devices: any[]; vehicles: any[] }) {
  const visibleVehicleIds = await getVisibleGpsVehicleIds(req);
  if (visibleVehicleIds === null) return payload;
  return {
    ...payload,
    vehicles: payload.vehicles.filter((v: any) => visibleVehicleIds.has(v.id)),
    // Unlinked units are management inventory and have no district/assignment
    // through which a non-management user could be authorized to view them.
    devices: payload.devices.filter(
      (d: any) => d.linkedVehicle?.id != null && visibleVehicleIds.has(d.linkedVehicle.id),
    ),
  };
}

// ── GET /api/gpstrace/devices ─────────────────────────────────────────────────
router.get("/api/gpstrace/devices", requireAnyAuth, async (req, res) => {
  if (!getToken()) {
    res.json({ configured: false, devices: [], vehicles: [] });
    return;
  }

  // Serve from cache if fresh
  if (_devicesCache && Date.now() - _devicesCache.ts < DEVICES_TTL_MS) {
    res.json(await scopeDevicesPayload(req, _devicesCache.payload));
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
    res.json(await scopeDevicesPayload(req, payload));
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace unavailable" });
  }
});

// ── POST /api/gpstrace/sync ───────────────────────────────────────────────────
// Manual sync writes fleet positions. The background poller remains service-side
// and unchanged; this endpoint is limited to the operational management roles.
router.post("/api/gpstrace/sync", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"), async (_req, res) => {
  if (!getToken() && !getToken2()) {
    res.json({ synced: 0, message: "No GPS-Trace tokens configured" });
    return;
  }

  try {
    const { data: vehicles } = await supa
      .from("vehicles")
      .select("id, gps_device_id, last_ping")
      .not("gps_device_id", "is", null)
      .neq("gps_device_id", "");

    const linkedVehicles = new Map<string, { id: number; lastPing: string | null }>();
    for (const v of vehicles ?? []) {
      if (v.gps_device_id) linkedVehicles.set(v.gps_device_id, { id: v.id, lastPing: v.last_ping });
    }

    const deviceIds = [...linkedVehicles.keys()];

    // Fetch telemetry in parallel — each device uses the right token
    const telResults = await Promise.allSettled(
      deviceIds.map(deviceId => {
        const { token, unitId } = resolveDevice(deviceId);
        if (!token) return Promise.reject(new Error("no token"));
        return apiGet(token, `/provider/units/${unitId}/telemetry`) as Promise<Telemetry>;
      })
    );

    let synced = 0;

    for (let i = 0; i < deviceIds.length; i++) {
      const vehicle = linkedVehicles.get(deviceIds[i])!;
      const result  = telResults[i];
      if (result.status === "rejected") continue;

      const tel = result.value;
      const lat = tel["position.latitude"]?.value ?? null;
      const lng = tel["position.longitude"]?.value ?? null;
      const ts  = tel["position.latitude"]?.ts ?? null;

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

    res.json({ synced, total: deviceIds.length, linked: linkedVehicles.size });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace sync failed" });
  }
});

// ── POST /api/gpstrace/link ───────────────────────────────────────────────────
router.post("/api/gpstrace/link", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const { vehicleId: rawVehicleId, deviceId: rawDeviceId, deviceName } = req.body as {
    vehicleId: number; deviceId: string; deviceName?: string;
  };
  const vehicleId = Number(rawVehicleId);
  const deviceId = String(rawDeviceId ?? "").trim();
  if (!Number.isFinite(vehicleId) || vehicleId <= 0 || !deviceId) {
    res.status(400).json({ error: "vehicleId and deviceId are required" });
    return;
  }

  // Validate the target before making any change. A device already linked to a
  // different vehicle is rejected rather than silently unlinking that vehicle.
  const [{ data: target, error: targetError }, { data: conflict, error: conflictError }] = await Promise.all([
    supa.from("vehicles").select("id,gps_device_id").eq("id", vehicleId).maybeSingle(),
    supa.from("vehicles").select("id").eq("gps_device_id", deviceId).neq("id", vehicleId).limit(1).maybeSingle(),
  ]);
  if (targetError) { res.status(500).json({ error: targetError.message }); return; }
  if (!target) { res.status(404).json({ error: "Vehicle not found" }); return; }
  if (conflictError) { res.status(500).json({ error: conflictError.message }); return; }
  if (conflict) {
    res.status(409).json({
      error: "GPS device is already linked to another vehicle",
      linkedVehicleId: (conflict as any).id,
    });
    return;
  }

  const linkUpdate = supa
    .from("vehicles")
    .update({ gps_device_id: deviceId })
    .eq("id", vehicleId);
  const guardedLinkUpdate = (target as any).gps_device_id == null
    ? linkUpdate.is("gps_device_id", null)
    : linkUpdate.eq("gps_device_id", (target as any).gps_device_id);
  const { data: updated, error } = await guardedLinkUpdate
    .select("id,gps_device_id")
    .maybeSingle();

  if (error) {
    const conflict = error.code === "23505";
    res.status(conflict ? 409 : 500).json({
      error: conflict ? "GPS device is already linked to another vehicle" : error.message,
    });
    return;
  }
  if (!updated || (updated as any).gps_device_id !== deviceId) {
    res.status(409).json({ error: "Vehicle link changed concurrently; GPS device link was not applied" });
    return;
  }
  const { data: linkedRows, error: verifyError } = await supa
    .from("vehicles")
    .select("id")
    .eq("gps_device_id", deviceId);
  if (verifyError) { res.status(500).json({ error: verifyError.message }); return; }
  if ((linkedRows ?? []).length !== 1 || (linkedRows as any[])[0]?.id !== vehicleId) {
    // There is no cross-row transaction available here. Restore the target's
    // prior value if a concurrent request created a duplicate association.
    await supa
      .from("vehicles")
      .update({ gps_device_id: (target as any).gps_device_id ?? null })
      .eq("id", vehicleId)
      .eq("gps_device_id", deviceId);
    res.status(409).json({ error: "Conflicting GPS device link detected; no link was created" });
    return;
  }

  invalidateDevicesCache();
  await logAudit(
    req,
    "LINK_GPS_DEVICE",
    "GPS",
    `Linked GPS device ${deviceId} to vehicle ID ${vehicleId}`,
    "vehicle",
    Number(vehicleId),
    { deviceId, deviceName: deviceName ?? null },
  );
  res.json({ success: true, vehicleId, deviceId, deviceName });
});

// ── DELETE /api/gpstrace/unlink/:vehicleId ────────────────────────────────────
router.delete("/api/gpstrace/unlink/:vehicleId", requireAnyAuth, requireRoleIfJwt("Admin", "ProjectManager"), async (req, res) => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isFinite(vehicleId) || vehicleId <= 0) {
    res.status(400).json({ error: "Invalid vehicleId" });
    return;
  }
  const { data: vehicle, error: vehicleError } = await supa
    .from("vehicles")
    .select("gps_device_id")
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehicleError || !vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  const previousDeviceId = (vehicle as any).gps_device_id ?? null;
  const unlinkUpdate = supa
    .from("vehicles")
    .update({ gps_device_id: null })
    .eq("id", vehicleId);
  const guardedUnlinkUpdate = previousDeviceId == null
    ? unlinkUpdate.is("gps_device_id", null)
    : unlinkUpdate.eq("gps_device_id", previousDeviceId);
  const { data: updated, error } = await guardedUnlinkUpdate
    .select("id,gps_device_id")
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!updated || (updated as any).gps_device_id != null) {
    res.status(409).json({ error: "Vehicle link changed concurrently; GPS device unlink was not applied" });
    return;
  }
  invalidateDevicesCache();
  await logAudit(
    req,
    "UNLINK_GPS_DEVICE",
    "GPS",
    `Unlinked GPS device from vehicle ID ${vehicleId}`,
    "vehicle",
    vehicleId,
    { deviceId: previousDeviceId },
  );
  res.json({ success: true });
});

export default router;
