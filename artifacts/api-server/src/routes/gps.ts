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

// ── POST /api/gps/retranslator ────────────────────────────────────────────────
// GPS-Trace Retranslator webhook. GPS-Trace pushes unit positions here via the
// sutran (or http) retranslator protocol. The auth_token from the retranslator
// config must match GPS_TRACE_API_TOKEN.
// No auth middleware — GPS-Trace does not send our session tokens.
router.post("/api/gps/retranslator", async (req, res) => {
  // ── 1. Verify authorization — fail closed: reject all if token not configured ─
  const expectedToken = process.env["GPS_TRACE_API_TOKEN"]?.trim();
  if (!expectedToken) {
    req.log.error({}, "GPS retranslator: GPS_TRACE_API_TOKEN not set — all pushes rejected");
    res.status(503).json({ error: "retranslator not configured" });
    return;
  }

  const authHeader = (req.headers["authorization"] ?? "") as string;
  const incomingToken =
    authHeader.startsWith("Bearer ") ? authHeader.slice(7) :
    authHeader.startsWith("Token ") ? authHeader.slice(6) :
    authHeader ||
    (req.query["token"] as string) ||
    "";

  if (incomingToken !== expectedToken) {
    req.log.warn(
      { hasAuthHeader: !!authHeader, hasQueryToken: !!(req.query["token"]) },
      "GPS retranslator: unauthorized push rejected"
    );
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // ── 2. Parse body — may be Buffer (binary sutran) or already parsed JSON ───
  let rawBody: Buffer | null = null;
  let jsonBody: any = null;

  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
    try { jsonBody = JSON.parse(rawBody.toString("utf8")); } catch (_) { /* binary */ }
  } else if (typeof req.body === "object" && req.body !== null) {
    jsonBody = req.body;
  } else if (typeof req.body === "string") {
    try { jsonBody = JSON.parse(req.body); } catch (_) { /* noop */ }
  }

  req.log.info(
    {
      contentType: req.headers["content-type"],
      bodySize: rawBody?.length ?? JSON.stringify(jsonBody ?? "").length,
      isJson: jsonBody !== null,
      rawHex: rawBody ? rawBody.slice(0, 64).toString("hex") : undefined,
      jsonSample: jsonBody ? JSON.stringify(jsonBody).slice(0, 400) : undefined,
    },
    "GPS retranslator push received"
  );

  // ── 3. Extract position from JSON body ────────────────────────────────────
  // GPS-Trace sutran/http retranslator sends position data as JSON:
  // [ { unit_id, lat, lon, speed, course, dt, ... } ] or similar
  const positions: Array<{ unitId: string; lat: number; lng: number; speed: number | null; heading: number | null; recordedAt: Date }> = [];

  const tryExtract = (obj: any): void => {
    if (!obj) return;
    // Unit ID variants
    const unitId = String(obj.unit_id ?? obj.unitId ?? obj.id ?? obj.device_id ?? obj.imei ?? "");
    // Coordinate variants
    const lat = Number(obj.lat ?? obj.latitude ?? obj.y ?? obj.gps?.lat);
    const lng = Number(obj.lon ?? obj.lng ?? obj.longitude ?? obj.x ?? obj.gps?.lon);
    if (!unitId || isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;
    const speed = obj.speed != null ? Number(obj.speed) : null;
    const heading = obj.course ?? obj.heading ?? obj.direction;
    const ts = obj.dt ?? obj.ts ?? obj.timestamp ?? obj.time;
    const recordedAt = ts ? new Date(typeof ts === "number" ? ts * 1000 : ts) : new Date();
    positions.push({ unitId, lat, lng, speed, heading: heading != null ? Number(heading) : null, recordedAt });
  };

  if (Array.isArray(jsonBody)) {
    jsonBody.forEach(tryExtract);
  } else if (jsonBody) {
    tryExtract(jsonBody);
    // Some formats wrap in { data: [...] }
    if (Array.isArray(jsonBody.data)) jsonBody.data.forEach(tryExtract);
    if (Array.isArray(jsonBody.positions)) jsonBody.positions.forEach(tryExtract);
    if (Array.isArray(jsonBody.messages)) jsonBody.messages.forEach(tryExtract);
  }

  // ── 4. Parse binary sutran if JSON yielded nothing ───────────────────────
  if (!positions.length && rawBody && rawBody.length > 8) {
    try {
      // Sutran binary layout (simplified): variable header, then position records
      // Look for any 4-byte float pairs that look like valid Sierra Leone coordinates
      // SL bounds: lat 6.9–9.9, lng -13.3 – -10.3
      for (let i = 0; i <= rawBody.length - 8; i++) {
        const lat = rawBody.readFloatBE(i);
        const lng = rawBody.readFloatBE(i + 4);
        if (lat >= 6.9 && lat <= 9.9 && lng >= -13.3 && lng <= -10.3) {
          // Plausible Sierra Leone coordinate — try to read speed/heading after
          const speed = i + 10 <= rawBody.length ? rawBody.readUInt16BE(i + 8) : null;
          const heading = i + 12 <= rawBody.length ? rawBody.readUInt16BE(i + 10) : null;
          req.log.info({ lat, lng, speed, heading, byteOffset: i }, "GPS retranslator: sutran binary coordinates found");
          // We don't know which unit — use the first linked vehicle
          const vRes = await query(`SELECT gps_device_id FROM vehicles WHERE gps_device_id IS NOT NULL LIMIT 1`);
          const unitId = vRes.rows[0]?.gps_device_id ?? "";
          if (unitId) positions.push({ unitId, lat, lng, speed: speed ?? null, heading: heading ? heading % 360 : null, recordedAt: new Date() });
          break;
        }
      }
    } catch (binaryErr: any) {
      req.log.warn({ err: binaryErr.message }, "GPS retranslator: binary parse error");
    }
  }

  // ── 5. Persist positions ──────────────────────────────────────────────────
  let saved = 0;
  for (const pos of positions) {
    const vRes = await query(
      `SELECT id FROM vehicles WHERE gps_device_id=$1`,
      [pos.unitId]
    );
    const vehicle = vRes.rows[0];
    if (!vehicle) {
      req.log.warn({ unitId: pos.unitId }, "GPS retranslator: no vehicle linked to this unit ID — skipping");
      continue;
    }
    await query(
      `INSERT INTO gps_track (vehicle_id, dispatch_id, latitude, longitude, speed, heading, accuracy, recorded_at)
       VALUES ($1, NULL, $2, $3, $4, $5, NULL, $6)`,
      [vehicle.id, pos.lat, pos.lng, pos.speed, pos.heading, pos.recordedAt]
    );
    await query(
      `UPDATE vehicles SET last_latitude=$1, last_longitude=$2, last_ping=$3 WHERE id=$4`,
      [pos.lat, pos.lng, pos.recordedAt, vehicle.id]
    );
    req.log.info({ vehicleId: vehicle.id, unitId: pos.unitId, lat: pos.lat, lng: pos.lng }, "GPS retranslator: position saved");
    saved++;
  }

  // Always respond 200 — GPS-Trace will retry on non-2xx responses
  res.json({ received: true, positionsParsed: positions.length, saved });
});

// ── GET /api/gps/trace/debug ──────────────────────────────────────────────────
// Returns raw GPS-Trace API responses + retranslator status for diagnostics
router.get("/api/gps/trace/debug", requireAnyAuth, async (_req, res) => {
  const token = process.env["GPS_TRACE_API_TOKEN"] ?? "";
  const vehiclesRes = await query(
    `SELECT id, plate_number, gps_device_id FROM vehicles WHERE gps_device_id IS NOT NULL AND gps_device_id != ''`
  );

  // Fetch retranslator status
  const [retranslators, retranslatorsErr] = await fetch(
    `https://api.gps-trace.com/provider/retranslators`,
    { headers: { "X-AccessToken": token } }
  ).then(async r => [await r.json(), null] as const)
    .catch(e => [null, e.message] as const);

  const unitResults = await Promise.all(vehiclesRes.rows.map(async (v: any) => {
    const unitId = Number(v.gps_device_id);
    const unitDetail = await fetch(
      `https://api.gps-trace.com/provider/units/${unitId}`,
      { headers: { "X-AccessToken": token, accept: "application/json" } }
    ).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
      .catch(e => ({ status: 0, error: e.message }));
    return { vehicleId: v.id, plateNumber: v.plate_number, unitId, unitDetail };
  }));

  res.json({
    retranslators: retranslatorsErr ?? retranslators,
    retranslatorWebhookUrl: "https://invendisapp.com/api/gps/retranslator",
    retranslatorInstruction: "In GPS-Trace Partner Console → Extended Services → Retranslators → Edit → set target URL to the webhook URL above",
    vehicles: unitResults,
  });
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
