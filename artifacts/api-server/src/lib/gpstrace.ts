/**
 * GPS poller — uses GPSTRACE_TOKEN (Wialon token/login → core/search_items).
 * Writes position data to Supabase (gps_track + vehicles).
 */
import { supa } from "./supabase.js";
import { logger } from "./logger.js";

const WIALON_HOST = (process.env["GPSTRACE_HOST"] ?? "hst-api.wialon.com").replace(/\/$/, "");
const WIALON_BASE = `https://${WIALON_HOST}/wialon/ajax.html`;

async function wialonGet(svc: string, params: object, sid?: string): Promise<any> {
  const qs = new URLSearchParams({ svc, params: JSON.stringify(params) });
  if (sid) qs.set("sid", sid);
  const resp = await fetch(`${WIALON_BASE}?${qs.toString()}`, { signal: AbortSignal.timeout(12_000) });
  return resp.json();
}

async function openSession(): Promise<string> {
  const token = process.env["GPSTRACE_TOKEN"] ?? process.env["GPS_TRACE_API_TOKEN"];
  if (!token) throw new Error("GPSTRACE_TOKEN is not set");
  const result = await wialonGet("token/login", { token });
  if (result.error) throw new Error(`GPS-Trace login failed (code ${result.error})`);
  return result.eid as string;
}

async function closeSession(sid: string): Promise<void> {
  await wialonGet("core/logout", {}, sid).catch(() => {});
}

interface WialonUnit {
  id: number;
  nm: string;
  pos?: {
    t: number;
    y: number;
    x: number;
    s: number;
    c: number;
  } | null;
}

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

export async function syncAllVehicles(): Promise<{ synced: number; skipped: number; source: string }> {
  const { data: vehicles, error } = await supa
    .from("vehicles")
    .select("id, gps_device_id, last_ping")
    .not("gps_device_id", "is", null)
    .neq("gps_device_id", "");

  if (error) {
    logger.error({ err: error.message }, "GPS sync: failed to fetch vehicles");
    return { synced: 0, skipped: 0, source: "error" };
  }

  const vList: { id: number; gps_device_id: string; last_ping: string | null }[] = vehicles ?? [];
  if (!vList.length) return { synced: 0, skipped: 0, source: "none" };

  let sid: string | null = null;
  try {
    sid = await openSession();
    const units = await fetchUnits(sid);

    const unitMap = new Map<string, WialonUnit>();
    for (const u of units) unitMap.set(String(u.id), u);

    let synced = 0;
    let skipped = 0;

    for (const v of vList) {
      const unit = unitMap.get(v.gps_device_id);
      if (!unit?.pos) { skipped++; continue; }

      const posTime = new Date(unit.pos.t * 1000);

      if (v.last_ping && posTime <= new Date(v.last_ping)) { skipped++; continue; }

      const { error: insertErr } = await supa.from("gps_track").insert({
        vehicle_id:  v.id,
        dispatch_id: null,
        latitude:    unit.pos.y,
        longitude:   unit.pos.x,
        speed:       unit.pos.s ?? null,
        heading:     unit.pos.c ?? null,
        accuracy:    null,
        recorded_at: posTime.toISOString(),
      });
      if (insertErr) {
        logger.warn({ vehicleId: v.id, err: insertErr.message }, "GPS poller: gps_track insert error");
        skipped++;
        continue;
      }

      await supa.from("vehicles").update({
        last_latitude:  unit.pos.y,
        last_longitude: unit.pos.x,
        last_ping:      posTime.toISOString(),
      }).eq("id", v.id);

      synced++;
    }

    logger.info({ synced, skipped, source: "gpstrace" }, "GPS sync complete");
    return { synced, skipped, source: "gpstrace" };
  } finally {
    if (sid) await closeSession(sid);
  }
}

let _pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller(intervalMs = 30_000): void {
  if (_pollTimer) return;
  logger.info({ intervalMs }, "Starting GPS poller (GPSTRACE_TOKEN)");
  _pollTimer = setInterval(async () => {
    try { await syncAllVehicles(); }
    catch (err: any) { logger.warn({ err: err.message }, "GPS poller error"); }
  }, intervalMs);
  syncAllVehicles().catch((err: any) =>
    logger.warn({ err: err.message }, "GPS initial sync error")
  );
}
