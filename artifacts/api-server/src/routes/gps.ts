import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { query } from "../lib/db.js";
import { snakeToCamel } from "../lib/supabase.js";
import { fetchAllTrackers, syncAllVehicles } from "../lib/gpstrace.js";
import { logAudit } from "../lib/audit.js";

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
// Vehicle sends its current position; auto-detects arrival within geofence.
router.post("/api/gps/ping", requireAnyAuth, async (req, res) => {
  const { vehicleId, dispatchId, latitude, longitude, speed, heading, accuracy } = req.body;

  await query(
    `INSERT INTO gps_track (vehicle_id, dispatch_id, latitude, longitude, speed, heading, accuracy, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
    [vehicleId, dispatchId ?? null, latitude, longitude, speed ?? null, heading ?? null, accuracy ?? null]
  );

  await query(
    `UPDATE vehicles SET last_latitude=$1, last_longitude=$2, last_ping=NOW() WHERE id=$3`,
    [latitude, longitude, vehicleId]
  );

  let arrivalStatus: string | null = null;

  if (dispatchId) {
    const dispRes = await query(
      `SELECT d.id, d.status, d.arrived_at,
              ds.latitude  AS dest_lat,  ds.longitude  AS dest_lng,
              COALESCE(ds.geofence_radius, 500) AS geofence_radius,
              dc.latitude  AS dist_lat,  dc.longitude  AS dist_lng
       FROM dispatches d
       JOIN campaigns c ON c.id = d.campaign_id
       LEFT JOIN distribution_sites ds ON ds.id = c.distribution_site_id
       LEFT JOIN districts dc ON dc.id = COALESCE(ds.district_id, c.district_id)
       WHERE d.id = $1`,
      [dispatchId]
    );
    const disp = dispRes.rows[0];

    if (disp && disp.status === "InTransit" && !disp.arrived_at) {
      const destLat = disp.dest_lat ?? disp.dist_lat;
      const destLng = disp.dest_lng ?? disp.dist_lng;
      if (destLat != null && destLng != null) {
        const distM = haversineMeters(latitude, longitude, destLat, destLng);
        if (distM <= disp.geofence_radius) {
          await query(
            `UPDATE dispatches SET arrived_at=NOW(), status='Arrived', updated_at=NOW() WHERE id=$1 AND arrived_at IS NULL`,
            [dispatchId]
          );
          arrivalStatus = "arrived";
        }
      }
    }
  }

  res.json({ success: true, arrivalStatus });
});

// ── GET /api/gps/vehicles ─────────────────────────────────────────────────────
// Returns in-transit vehicles enriched with destination + distance info.
router.get("/api/gps/vehicles", requireAnyAuth, async (_req, res) => {
  const result = await query(
    `SELECT
       v.id,
       v.plate_number,
       v.vehicle_code,
       v.vehicle_type,
       v.last_latitude,
       v.last_longitude,
       v.last_ping,
       d.id           AS dispatch_id,
       d.manifest_code,
       d.status       AS dispatch_status,
       d.departed_at,
       d.arrived_at,
       c.name         AS campaign_name,
       ds.name        AS destination_name,
       ds.latitude    AS dest_lat,
       ds.longitude   AS dest_lng,
       COALESCE(ds.geofence_radius, 500) AS geofence_radius,
       dc.name        AS district_name,
       dc.latitude    AS district_lat,
       dc.longitude   AS district_lng,
       dr.full_name   AS driver_name
     FROM vehicles v
     LEFT JOIN dispatches d
       ON d.vehicle_id = v.id AND d.status IN ('InTransit','Arrived')
     LEFT JOIN campaigns c ON c.id = d.campaign_id
     LEFT JOIN distribution_sites ds ON ds.id = c.distribution_site_id
     LEFT JOIN districts dc ON dc.id = COALESCE(ds.district_id, c.district_id)
     LEFT JOIN drivers dr ON dr.id = d.driver_id
     WHERE v.status = 'InTransit'
     ORDER BY v.last_ping DESC NULLS LAST`,
    []
  );

  const rows = result.rows.map((r: any) => {
    const base = snakeToCamel(r) as Record<string, any>;
    const destLat: number | null = r.dest_lat ?? r.district_lat ?? null;
    const destLng: number | null = r.dest_lng ?? r.district_lng ?? null;
    base.effectiveDestLat  = destLat;
    base.effectiveDestLng  = destLng;
    base.destinationLabel  = r.destination_name ?? (r.district_name ? `${r.district_name} District` : null);
    base.hasDestination    = destLat != null && destLng != null;
    if (r.last_latitude != null && r.last_longitude != null && destLat != null && destLng != null) {
      const distM = haversineMeters(r.last_latitude, r.last_longitude, destLat, destLng);
      base.distanceToDestM   = Math.round(distM);
      base.distanceLabel     = formatDistance(distM);
      base.withinGeofence    = distM <= (r.geofence_radius ?? 500);
    } else {
      base.distanceToDestM  = null;
      base.distanceLabel    = null;
      base.withinGeofence   = null;
    }
    return base;
  });

  res.json(rows);
});

// ── GET /api/gps/track/:vehicleId ────────────────────────────────────────────
router.get("/api/gps/track/:vehicleId", requireAnyAuth, async (req, res) => {
  const { limit = "100" } = req.query as Record<string, string>;
  const result = await query(
    `SELECT * FROM gps_track WHERE vehicle_id=$1 ORDER BY recorded_at DESC LIMIT $2`,
    [Number(req.params.vehicleId), Number(limit)]
  );
  res.json(snakeToCamel(result.rows.reverse()));
});

// ── GET /api/gps/trace/units ──────────────────────────────────────────────────
// Fetch all tracker units from GPS-Trace account
router.get("/api/gps/trace/units", requireAnyAuth, async (_req, res) => {
  try {
    const trackers = await fetchAllTrackers();
    res.json(trackers.map((t: any) => ({
      id: t.id,
      label: t.name ?? t.label ?? `Unit #${t.id}`,
      deviceType: t.device_type_id,
      ident: t.ident,
      enabled: t.enabled,
      lastActive: t.last_active,
      status: t.last_active ? "active" : "registered",
    })));
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── POST /api/gps/trace/link ──────────────────────────────────────────────────
// Link a GPS-Trace tracker unit to a vehicle
router.post("/api/gps/trace/link", requireAnyAuth, async (req, res) => {
  const { vehicleId, unitId, unitLabel } = req.body as { vehicleId: number; unitId: string; unitLabel?: string };
  if (!vehicleId || !unitId) {
    res.status(400).json({ error: "vehicleId and unitId are required" });
    return;
  }
  const vRes = await query(`SELECT plate_number, vehicle_code FROM vehicles WHERE id=$1`, [vehicleId]);
  const vehicle = vRes.rows[0];
  await query(`UPDATE vehicles SET gps_device_id=$1 WHERE id=$2`, [String(unitId), vehicleId]);
  await logAudit(
    req, "LINK", "GPS",
    `GPS tracker ${unitLabel ?? `Unit #${unitId}`} linked to vehicle ${vehicle?.plate_number ?? vehicleId}`,
    "Vehicle", vehicleId,
    { unitId, unitLabel, plateNumber: vehicle?.plate_number, vehicleCode: vehicle?.vehicle_code }
  );
  res.json({ success: true });
});

// ── POST /api/gps/trace/unlink ────────────────────────────────────────────────
// Unlink GPS-Trace tracker from a vehicle
router.post("/api/gps/trace/unlink", requireAnyAuth, async (req, res) => {
  const { vehicleId } = req.body as { vehicleId: number };
  if (!vehicleId) { res.status(400).json({ error: "vehicleId required" }); return; }
  const vRes = await query(`SELECT plate_number, vehicle_code, gps_device_id FROM vehicles WHERE id=$1`, [vehicleId]);
  const vehicle = vRes.rows[0];
  await query(`UPDATE vehicles SET gps_device_id=NULL WHERE id=$1`, [vehicleId]);
  await logAudit(
    req, "UNLINK", "GPS",
    `GPS tracker unlinked from vehicle ${vehicle?.plate_number ?? vehicleId}`,
    "Vehicle", vehicleId,
    { previousUnitId: vehicle?.gps_device_id, plateNumber: vehicle?.plate_number }
  );
  res.json({ success: true });
});

// ── POST /api/gps/trace/sync ──────────────────────────────────────────────────
// Manually trigger a GPS-Trace position sync
router.post("/api/gps/trace/sync", requireAnyAuth, async (_req, res) => {
  try {
    const result = await syncAllVehicles();
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ── GET /api/gps/trace/status ─────────────────────────────────────────────────
// Returns linked vehicle→unit mapping + last ping info
router.get("/api/gps/trace/status", requireAnyAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, vehicle_code, plate_number, gps_device_id, last_ping, last_latitude, last_longitude
     FROM vehicles ORDER BY plate_number`
  );
  res.json(snakeToCamel(result.rows));
});

export default router;
