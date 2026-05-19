/**
 * GPS-Trace / Wialon integration
 *
 * GPS-Trace is built on the Wialon platform. Positions are polled via the
 * Wialon Remote API using an access token generated in the GPS-Trace account.
 *
 * Required env var:
 *   GPSTRACE_TOKEN  – API token from GPS-Trace → My Account → API Access
 *   GPSTRACE_HOST   – (optional) Wialon host; default: hst-api.wialon.com
 */
import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { query } from "../lib/db.js";
import { supa } from "../lib/supabase.js";

const router = Router();

const WIALON_HOST = process.env.GPSTRACE_HOST ?? "hst-api.wialon.com";
const WIALON_BASE = `https://${WIALON_HOST}/wialon/ajax.html`;
const TOKEN       = process.env.GPSTRACE_TOKEN ?? "";

// ── Wialon helpers ────────────────────────────────────────────────────────────

async function wialonGet(svc: string, params: object, sid?: string): Promise<any> {
  const qs = new URLSearchParams({ svc, params: JSON.stringify(params) });
  if (sid) qs.set("sid", sid);
  const resp = await fetch(`${WIALON_BASE}?${qs.toString()}`, { signal: AbortSignal.timeout(12_000) });
  return resp.json();
}

async function openSession(): Promise<string> {
  if (!TOKEN) throw new Error("GPSTRACE_TOKEN is not set");
  const result = await wialonGet("token/login", { token: TOKEN });
  if (result.error) throw new Error(`GPS-Trace login failed (code ${result.error})`);
  return result.eid as string;
}

async function closeSession(sid: string): Promise<void> {
  await wialonGet("core/logout", {}, sid).catch(() => {});
}

/**
 * Fetch all avl_unit items from Wialon with last-position data.
 * flags: 1 (basic) + 8 (last known position) + 1024 (last message) = 1033
 */
async function fetchUnits(sid: string): Promise<WialonUnit[]> {
  const result = await wialonGet(
    "core/search_items",
    {
      spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
      force: 1,
      flags: 1033,
      from: 0,
      to: 0,
    },
    sid
  );
  return (result.items ?? []) as WialonUnit[];
}

interface WialonUnit {
  id: number;
  nm: string;
  pos?: {
    t: number;   // unix timestamp
    y: number;   // latitude
    x: number;   // longitude
    s: number;   // speed km/h
    c: number;   // course (heading degrees)
    z?: number;  // altitude
    sc?: number; // satellite count
  } | null;
}

// ── GET /api/gpstrace/devices ─────────────────────────────────────────────────
// Returns GPS-Trace devices enriched with which vehicle each is linked to.
router.get("/api/gpstrace/devices", requireAuth, async (_req, res) => {
  if (!TOKEN) {
    res.json({ configured: false, devices: [], vehicles: [] });
    return;
  }

  let sid: string | null = null;
  try {
    sid = await openSession();
    const units = await fetchUnits(sid);

    // Load all vehicles with their linked gps_device_id
    const { data: vehicles } = await supa
      .from("vehicles")
      .select("id, plate_number, vehicle_type, vehicle_code, gps_device_id, last_ping");

    const vehicleMap: Record<string, any> = {};
    for (const v of vehicles ?? []) {
      if (v.gps_device_id) vehicleMap[v.gps_device_id] = v;
    }

    const devices = units.map(u => ({
      deviceId:    String(u.id),
      deviceName:  u.nm,
      lastSeen:    u.pos?.t ? new Date(u.pos.t * 1000).toISOString() : null,
      latitude:    u.pos?.y ?? null,
      longitude:   u.pos?.x ?? null,
      speed:       u.pos?.s ?? null,
      heading:     u.pos?.c ?? null,
      linkedVehicle: vehicleMap[String(u.id)] ?? null,
    }));

    res.json({ configured: true, devices, vehicles: vehicles ?? [] });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace unavailable" });
  } finally {
    if (sid) await closeSession(sid);
  }
});

// ── POST /api/gpstrace/sync ───────────────────────────────────────────────────
// Pulls latest position for every linked vehicle and writes to gps_track.
router.post("/api/gpstrace/sync", requireAuth, async (_req, res) => {
  if (!TOKEN) {
    res.json({ synced: 0, message: "GPSTRACE_TOKEN not configured" });
    return;
  }

  let sid: string | null = null;
  try {
    sid = await openSession();
    const units = await fetchUnits(sid);

    // Load vehicles that have a linked device
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
      if (!vehicle || !unit.pos) continue;

      const posTime = new Date(unit.pos.t * 1000);

      // Skip if this position is older than what we already have
      if (vehicle.lastPing && posTime <= new Date(vehicle.lastPing)) continue;

      await query(
        `INSERT INTO gps_track (vehicle_id, latitude, longitude, speed, heading, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [vehicle.id, unit.pos.y, unit.pos.x, unit.pos.s ?? null, unit.pos.c ?? null, posTime]
      );

      await query(
        `UPDATE vehicles SET last_latitude=$1, last_longitude=$2, last_ping=$3 WHERE id=$4`,
        [unit.pos.y, unit.pos.x, posTime, vehicle.id]
      );

      synced++;
    }

    res.json({ synced, total: units.length, linked: linkedVehicles.size });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "GPS-Trace sync failed" });
  } finally {
    if (sid) await closeSession(sid);
  }
});

// ── POST /api/gpstrace/link ───────────────────────────────────────────────────
// Links a GPS-Trace device ID to a vehicle.
router.post("/api/gpstrace/link", requireAuth, async (req, res) => {
  const { vehicleId, deviceId, deviceName } = req.body as {
    vehicleId: number; deviceId: string; deviceName?: string;
  };
  if (!vehicleId || !deviceId) {
    res.status(400).json({ error: "vehicleId and deviceId are required" });
    return;
  }

  // Ensure no other vehicle already claims this device
  await supa.from("vehicles").update({ gps_device_id: null }).eq("gps_device_id", deviceId);

  const { error } = await supa
    .from("vehicles")
    .update({ gps_device_id: deviceId })
    .eq("id", vehicleId);

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ success: true, vehicleId, deviceId, deviceName });
});

// ── DELETE /api/gpstrace/unlink/:vehicleId ────────────────────────────────────
router.delete("/api/gpstrace/unlink/:vehicleId", requireAuth, async (req, res) => {
  const { error } = await supa
    .from("vehicles")
    .update({ gps_device_id: null })
    .eq("id", Number(req.params.vehicleId));

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ success: true });
});

export default router;
