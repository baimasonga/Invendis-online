import { Router } from "express";
import { requireAnyAuth, requireRoleIfJwt } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { haversineMeters } from "./gps.js";

const router = Router();
router.use(
  "/api/gis",
  requireAnyAuth,
  requireRoleIfJwt("Admin", "ProjectManager", "WarehouseManager"),
);

// ── Palette (vehicle colour mode) ────────────────────────────────────────────
const ROUTE_COLORS = [
  "#3b82f6","#ef4444","#22c55e","#f59e0b","#8b5cf6",
  "#ec4899","#06b6d4","#84cc16","#f97316","#a855f7",
];

// ── GIS utility functions ─────────────────────────────────────────────────────
function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function hexToKmlAbgr(hex: string): string {
  const r = hex.slice(1, 3); const g = hex.slice(3, 5); const b = hex.slice(5, 7);
  return `ff${b}${g}${r}`;
}

/** Bearing from (lat1,lon1) → (lat2,lon2) in degrees 0–360 (WGS84) */
function computeBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Converts decimal bearing (0–360°) to 8-point cardinal/ordinal abbreviation */
function bearingToCardinal(deg: number): string {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/**
 * FHWA-inspired functional class inference from average speed.
 * Adapted for rural Sierra Leone road network context.
 */
function inferFuncClass(avgSpeedKmh: number | null): string {
  if (avgSpeedKmh == null) return "Unknown";
  if (avgSpeedKmh > 80)  return "Highway / Trunk Road";
  if (avgSpeedKmh > 60)  return "Primary Road";
  if (avgSpeedKmh > 40)  return "Secondary / Collector Road";
  if (avgSpeedKmh > 20)  return "Local / Rural Road";
  return "Track / Earth Path";
}

/**
 * ISO 19157 inspired GPS-track data-quality rating.
 * Based on ping density (observations per km) as the core completeness metric.
 * Thresholds derived from FHWA road-centerline accuracy guidance:
 *   ≥10 pings/km  → surveying-grade centerline quality
 *   5–10          → acceptable for primary road mapping
 *   2–5           → indicative mapping quality
 *   <2            → poor/indicative only
 */
function inferDataQuality(pingDensityPerKm: number): "EXCELLENT" | "GOOD" | "FAIR" | "POOR" {
  if (pingDensityPerKm >= 10) return "EXCELLENT";
  if (pingDensityPerKm >= 5)  return "GOOD";
  if (pingDensityPerKm >= 2)  return "FAIR";
  return "POOR";
}

/**
 * ArcGIS Traffic-layer compatible speed-to-colour mapping.
 * Green = free-flow/fast; Red = stop-and-go/slow (road condition indicator).
 */
function speedToHex(speedKmh: number | null): string {
  if (speedKmh == null) return "#94a3b8";   // slate – no data
  if (speedKmh < 10)   return "#dc2626";    // red     – stopped
  if (speedKmh < 25)   return "#ef4444";    // red     – very slow
  if (speedKmh < 40)   return "#f97316";    // orange  – slow
  if (speedKmh < 55)   return "#eab308";    // yellow  – moderate
  if (speedKmh < 70)   return "#84cc16";    // lime    – good
  if (speedKmh < 85)   return "#22c55e";    // green   – fast
  return "#3b82f6";                          // blue    – highway speed
}

function qualityToHex(q: "EXCELLENT" | "GOOD" | "FAIR" | "POOR"): string {
  return { EXCELLENT: "#22c55e", GOOD: "#84cc16", FAIR: "#f59e0b", POOR: "#ef4444" }[q] ?? "#94a3b8";
}

// ── Route analytics computation ───────────────────────────────────────────────
function computeAnalytics(pts: any[], distKm: number, avgSpeedKmh: number | null) {
  const pingDensityPerKm = distKm > 0.01
    ? Math.round((pts.length / distKm) * 10) / 10
    : 0;

  const validSpeeds = pts.map((p: any) => Number(p.speed)).filter((s) => s > 0 && isFinite(s));
  const maxSpeedKmh  = validSpeeds.length ? Math.round(Math.max(...validSpeeds))  : null;
  let speedVarianceKmh: number | null = null;
  if (validSpeeds.length > 1) {
    const mean = validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length;
    const variance = validSpeeds.reduce((s, v) => s + (v - mean) ** 2, 0) / validSpeeds.length;
    speedVarianceKmh = Math.round(Math.sqrt(variance));
  }

  // Bearing: from first point to last point
  let dominantBearing: number | null = null;
  if (pts.length >= 2) {
    const f = pts[0], l = pts[pts.length - 1];
    dominantBearing = Math.round(computeBearing(
      Number(f.latitude), Number(f.longitude), Number(l.latitude), Number(l.longitude)
    ));
  }
  const cardinalDir = dominantBearing != null ? bearingToCardinal(dominantBearing) : null;

  // Temporal gap analysis: count gaps > 5 min (300 s) between consecutive pings
  let gapCount = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = new Date(pts[i].recorded_at).getTime() - new Date(pts[i - 1].recorded_at).getTime();
    if (dt > 5 * 60 * 1000) gapCount++;
  }

  const n = validSpeeds.length;
  const speedBands = {
    stopped:  n ? Math.round(validSpeeds.filter(s => s <  5).length / n * 100) : 0,
    slow:     n ? Math.round(validSpeeds.filter(s => s >= 5  && s < 25).length / n * 100) : 0,
    moderate: n ? Math.round(validSpeeds.filter(s => s >= 25 && s < 55).length / n * 100) : 0,
    fast:     n ? Math.round(validSpeeds.filter(s => s >= 55 && s < 85).length / n * 100) : 0,
    highway:  n ? Math.round(validSpeeds.filter(s => s >= 85).length / n * 100) : 0,
  };

  const dataQuality  = inferDataQuality(pingDensityPerKm);
  const funcClassInferred = inferFuncClass(avgSpeedKmh);
  const speedColor   = speedToHex(avgSpeedKmh);
  const qualityColor = qualityToHex(dataQuality);

  return {
    pingDensityPerKm, maxSpeedKmh, speedVarianceKmh,
    dominantBearing, cardinalDir, gapCount,
    funcClassInferred, dataQuality, speedBands,
    speedColor, qualityColor,
  };
}

// ── Core buildRoutes ──────────────────────────────────────────────────────────
interface RouteRecord {
  routeId: string;
  vehicleId: number; plateNumber: string; vehicleCode: string | null;
  dispatchId: number | null; manifestCode: string | null;
  campaignName: string | null; districtName: string | null;
  driverName: string | null; dispatchStatus: string | null;
  startTime: string; endTime: string;
  durationMinutes: number; distanceKm: number;
  avgSpeedKmh: number | null;
  pingCount: number;
  // Analytics
  pingDensityPerKm: number; maxSpeedKmh: number | null;
  speedVarianceKmh: number | null; dominantBearing: number | null;
  cardinalDir: string | null; gapCount: number;
  funcClassInferred: string;
  dataQuality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  speedBands: { stopped: number; slow: number; moderate: number; fast: number; highway: number };
  // Rendering
  color: string; speedColor: string; qualityColor: string;
  // Geometry
  coordinates: [number, number][];
  speedPoints: { lat: number; lng: number; speed: number | null }[];
  rawPoints: { lat: number; lng: number; speed: number | null; heading: number | null; ts: string }[];
}

async function buildRoutes(opts: {
  vehicleId?: number; dispatchId?: number;
  from?: string; to?: string; limit?: number;
}): Promise<RouteRecord[]> {
  const { vehicleId, dispatchId, from, to, limit = 10000 } = opts;

  let q = supa
    .from("gps_track")
    .select("id, vehicle_id, dispatch_id, latitude, longitude, speed, heading, recorded_at")
    .order("recorded_at", { ascending: true })
    .limit(limit);
  if (vehicleId)  q = q.eq("vehicle_id", vehicleId);
  if (dispatchId) q = q.eq("dispatch_id", dispatchId);
  if (from) q = q.gte("recorded_at", from);
  if (to)   q = q.lte("recorded_at", to);

  const { data: tracks, error } = await q;
  if (error) throw new Error(error.message);
  const all: any[] = tracks ?? [];
  if (!all.length) return [];

  // Fetch enrichment data
  const vehicleIds  = [...new Set(all.map(t => t.vehicle_id))] as number[];
  const dspIds      = [...new Set(all.map(t => t.dispatch_id).filter(Boolean))] as number[];

  const [{ data: vehicles }, dspResult] = await Promise.all([
    supa.from("vehicles").select("id, plate_number, vehicle_code").in("id", vehicleIds),
    dspIds.length
      ? supa.from("dispatches").select("id, manifest_code, campaign_id, driver_id, status").in("id", dspIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const vehMap: Record<number, any> = Object.fromEntries((vehicles ?? []).map((v: any) => [v.id, v]));
  const dspMeta: Record<number, any> = {};
  const dspRows: any[] = (dspResult as any).data ?? [];

  if (dspRows.length) {
    const campIds = [...new Set(dspRows.map(d => d.campaign_id).filter(Boolean))] as number[];
    const drvIds  = [...new Set(dspRows.map(d => d.driver_id).filter(Boolean))] as number[];
    const [{ data: camps }, { data: drvs }] = await Promise.all([
      campIds.length ? supa.from("campaigns").select("id, name, district_id").in("id", campIds) : Promise.resolve({ data: [] as any[] }),
      drvIds.length  ? supa.from("drivers").select("id, full_name").in("id", drvIds)            : Promise.resolve({ data: [] as any[] }),
    ]);
    const distIds = [...new Set((camps ?? []).map((c: any) => c.district_id).filter(Boolean))] as number[];
    const { data: dists } = distIds.length ? await supa.from("districts").select("id, name").in("id", distIds) : { data: [] as any[] };
    const campMap  = Object.fromEntries((camps ?? []).map((c: any) => [c.id, c]));
    const drvMap   = Object.fromEntries((drvs  ?? []).map((d: any) => [d.id, d]));
    const distMap  = Object.fromEntries((dists ?? []).map((d: any) => [d.id, d]));
    for (const d of dspRows) {
      const camp = d.campaign_id ? campMap[d.campaign_id] : null;
      const dist = camp?.district_id ? distMap[camp.district_id] : null;
      dspMeta[d.id] = {
        manifestCode: d.manifest_code ?? null,
        campaignName: camp?.name ?? null,
        districtName: dist?.name ?? null,
        driverName:   d.driver_id ? drvMap[d.driver_id]?.full_name ?? null : null,
        status:       d.status ?? null,
      };
    }
  }

  // Group tracks → routes
  const groups = new Map<string, any[]>();
  for (const t of all) {
    const key = `${t.vehicle_id}:${t.dispatch_id ?? t.recorded_at.slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const vehColorIdx = new Map<number, number>();
  let colorCounter = 0;
  const routes: RouteRecord[] = [];

  for (const pts of groups.values()) {
    if (pts.length < 2) continue;
    const first = pts[0], last = pts[pts.length - 1];
    const veh   = vehMap[first.vehicle_id];
    const dm    = first.dispatch_id ? dspMeta[first.dispatch_id] ?? {} : {};

    let distM = 0, speedSum = 0, speedN = 0;
    for (let i = 1; i < pts.length; i++) {
      distM += haversineMeters(pts[i-1].latitude, pts[i-1].longitude, pts[i].latitude, pts[i].longitude);
      if (pts[i].speed != null && pts[i].speed > 0) { speedSum += Number(pts[i].speed); speedN++; }
    }
    const distKm      = Math.round(distM / 10) / 100;
    const avgSpeedKmh = speedN > 0 ? Math.round(speedSum / speedN) : null;
    const startTime   = new Date(first.recorded_at);
    const endTime     = new Date(last.recorded_at);
    const durMin      = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    if (!vehColorIdx.has(first.vehicle_id)) {
      vehColorIdx.set(first.vehicle_id, colorCounter % ROUTE_COLORS.length);
      colorCounter++;
    }
    const color = ROUTE_COLORS[vehColorIdx.get(first.vehicle_id)!];
    const analytics = computeAnalytics(pts, distKm, avgSpeedKmh);
    const dateKey   = startTime.toISOString().slice(0, 10);

    routes.push({
      routeId:        `${first.vehicle_id}-${first.dispatch_id ?? dateKey}`,
      vehicleId:      first.vehicle_id,
      plateNumber:    veh?.plate_number ?? `VEH-${first.vehicle_id}`,
      vehicleCode:    veh?.vehicle_code ?? null,
      dispatchId:     first.dispatch_id ?? null,
      manifestCode:   dm.manifestCode ?? null,
      campaignName:   dm.campaignName ?? null,
      districtName:   dm.districtName ?? null,
      driverName:     dm.driverName   ?? null,
      dispatchStatus: dm.status       ?? null,
      startTime:      startTime.toISOString(),
      endTime:        endTime.toISOString(),
      durationMinutes: durMin,
      distanceKm:     distKm,
      avgSpeedKmh,
      pingCount:      pts.length,
      color,
      coordinates:    pts.map((p: any) => [Number(p.longitude), Number(p.latitude)]),
      speedPoints:    pts.map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude), speed: p.speed != null ? Number(p.speed) : null })),
      rawPoints:      pts.map((p: any) => ({ lat: Number(p.latitude), lng: Number(p.longitude), speed: p.speed != null ? Number(p.speed) : null, heading: p.heading ?? null, ts: p.recorded_at })),
      ...analytics,
    });
  }
  return routes.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

function parseOpts(q: Record<string, string>) {
  return {
    vehicleId:  q.vehicleId  ? Number(q.vehicleId)  : undefined,
    dispatchId: q.dispatchId ? Number(q.dispatchId) : undefined,
    from:  q.from  || undefined,
    to:    q.to    || undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  };
}

function fileLabel(from?: string, to?: string): string {
  const parts = [from?.slice(0, 10), to?.slice(0, 10)].filter(Boolean);
  return parts.length ? parts.join("_to_") : new Date().toISOString().slice(0, 10);
}

// ── GET /api/gis/routes ───────────────────────────────────────────────────────
router.get("/api/gis/routes", async (req, res) => {
  try {
    const routes = await buildRoutes(parseOpts(req.query as Record<string, string>));
    res.json(routes.map(r => { const { rawPoints: _r, ...rest } = r; return rest; }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/gis/export/geojson ───────────────────────────────────────────────
router.get("/api/gis/export/geojson", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));
    const totalKm = routes.reduce((s, r) => s + r.distanceKm, 0);

    const body = {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      metadata: {
        title: "Invendis Road Coverage Report",
        standard: "RFC 7946 GeoJSON",
        coordinateSystem: "WGS84 (EPSG:4326)",
        coordinateOrder: "[longitude, latitude]",
        generated: new Date().toISOString(),
        source: "Invendis Distribution Management System",
        captureMethod: "GPS_TRACK",
        qualityFramework: "ISO 19157",
        totalRoutes: routes.length,
        totalDistanceKm: Math.round(totalKm * 100) / 100,
      },
      features: routes.map(r => ({
        type: "Feature",
        id: r.routeId,
        geometry: { type: "LineString", coordinates: r.coordinates },
        properties: {
          // Route identity
          ROUTE_ID:       r.routeId,
          VEHICLE_ID:     r.vehicleId,
          PLATE_NO:       r.plateNumber,
          VEHICLE_CODE:   r.vehicleCode,
          DISPATCH_ID:    r.dispatchId,
          MANIFEST_CODE:  r.manifestCode,
          CAMPAIGN:       r.campaignName,
          DISTRICT:       r.districtName,
          DRIVER:         r.driverName,
          // Temporal
          SURVEY_DATE:    r.startTime.slice(0, 10),
          SURVEY_YEAR:    r.startTime.slice(0, 4),
          START_TIME:     r.startTime,
          END_TIME:       r.endTime,
          DURATION_MIN:   r.durationMinutes,
          // Spatial
          ROUTE_LEN_KM:   r.distanceKm,
          AVG_SPEED_KMH:  r.avgSpeedKmh,
          MAX_SPEED_KMH:  r.maxSpeedKmh,
          SPEED_VAR_KMH:  r.speedVarianceKmh,
          // Analytics (GIS attributes)
          PING_COUNT:     r.pingCount,
          PING_DENSITY:   r.pingDensityPerKm,
          GAP_COUNT:      r.gapCount,
          BEARING_DEG:    r.dominantBearing,
          CARDINAL_DIR:   r.cardinalDir,
          FUNC_CLASS:     r.funcClassInferred,
          DATA_QUALITY:   r.dataQuality,
          SPEED_STOPPED:  r.speedBands.stopped,
          SPEED_SLOW:     r.speedBands.slow,
          SPEED_MODERATE: r.speedBands.moderate,
          SPEED_FAST:     r.speedBands.fast,
          SPEED_HIGHWAY:  r.speedBands.highway,
          // Metadata
          CAPTURE_METHOD: "GPS_TRACK",
          COORD_SYS:      "WGS84 (EPSG:4326)",
          COORD_ORDER:    "[longitude, latitude]",
        },
      })),
    };

    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_roads_${fileLabel(q.from, q.to)}.geojson"`);
    res.json(body);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/gis/export/kml ───────────────────────────────────────────────────
router.get("/api/gis/export/kml", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));
    const vehColors = new Map<number, string>();
    for (const r of routes) if (!vehColors.has(r.vehicleId)) vehColors.set(r.vehicleId, r.color);
    const styles = [...vehColors.entries()].map(([id, hex]) =>
      `  <Style id="v${id}"><LineStyle><color>${hexToKmlAbgr(hex)}</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`
    ).join("\n");
    const marks = routes.map(r => {
      const dH = Math.floor(r.durationMinutes / 60), dM = r.durationMinutes % 60;
      return `  <Placemark>
    <name>${escXml(r.plateNumber)} — ${r.startTime.slice(0, 10)}</name>
    <description><![CDATA[<b>Plate:</b> ${escXml(r.plateNumber)}<br/><b>Driver:</b> ${escXml(r.driverName ?? "N/A")}<br/><b>Manifest:</b> ${escXml(r.manifestCode ?? "N/A")}<br/><b>Campaign:</b> ${escXml(r.campaignName ?? "N/A")}<br/><b>District:</b> ${escXml(r.districtName ?? "N/A")}<br/><b>Date:</b> ${r.startTime.slice(0, 10)}<br/><b>Duration:</b> ${dH}h ${dM}m<br/><b>Distance:</b> ${r.distanceKm} km<br/><b>Avg Speed:</b> ${r.avgSpeedKmh ?? "N/A"} km/h<br/><b>Max Speed:</b> ${r.maxSpeedKmh ?? "N/A"} km/h<br/><b>Bearing:</b> ${r.dominantBearing ?? "N/A"}° ${r.cardinalDir ?? ""}<br/><b>Func. Class:</b> ${escXml(r.funcClassInferred)}<br/><b>Data Quality:</b> ${r.dataQuality}<br/><b>Ping Density:</b> ${r.pingDensityPerKm} pings/km<br/><b>GPS Pings:</b> ${r.pingCount}<br/><b>Data Gaps:</b> ${r.gapCount}<br/><b>CRS:</b> WGS84 (EPSG:4326)]]></description>
    <styleUrl>#v${r.vehicleId}</styleUrl>
    <TimeSpan><begin>${r.startTime}</begin><end>${r.endTime}</end></TimeSpan>
    <LineString>
      <tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>
      <coordinates>${r.coordinates.map(c => `${c[0]},${c[1]},0`).join(" ")}</coordinates>
    </LineString>
    <ExtendedData>
      <Data name="ROUTE_ID"><value>${escXml(r.routeId)}</value></Data>
      <Data name="VEHICLE_ID"><value>${r.vehicleId}</value></Data>
      <Data name="PLATE_NO"><value>${escXml(r.plateNumber)}</value></Data>
      <Data name="MANIFEST_CODE"><value>${escXml(r.manifestCode ?? "")}</value></Data>
      <Data name="DISTRICT"><value>${escXml(r.districtName ?? "")}</value></Data>
      <Data name="ROUTE_LEN_KM"><value>${r.distanceKm}</value></Data>
      <Data name="AVG_SPEED_KMH"><value>${r.avgSpeedKmh ?? ""}</value></Data>
      <Data name="MAX_SPEED_KMH"><value>${r.maxSpeedKmh ?? ""}</value></Data>
      <Data name="BEARING_DEG"><value>${r.dominantBearing ?? ""}</value></Data>
      <Data name="CARDINAL_DIR"><value>${r.cardinalDir ?? ""}</value></Data>
      <Data name="FUNC_CLASS"><value>${escXml(r.funcClassInferred)}</value></Data>
      <Data name="DATA_QUALITY"><value>${r.dataQuality}</value></Data>
      <Data name="PING_COUNT"><value>${r.pingCount}</value></Data>
      <Data name="PING_DENSITY"><value>${r.pingDensityPerKm}</value></Data>
      <Data name="GAP_COUNT"><value>${r.gapCount}</value></Data>
      <Data name="SURVEY_DATE"><value>${r.startTime.slice(0, 10)}</value></Data>
      <Data name="COORD_SYS"><value>WGS84 (EPSG:4326)</value></Data>
      <Data name="CAPTURE_METHOD"><value>GPS_TRACK</value></Data>
    </ExtendedData>
  </Placemark>`;
    }).join("\n");

    const now = new Date().toISOString();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Invendis Road Coverage — ${fileLabel(q.from, q.to)}</name>
  <description>Generated: ${now} | Routes: ${routes.length} | Source: Invendis Distribution Management System | CRS: WGS84 (EPSG:4326) | Standard: OGC KML 2.2</description>
  <open>1</open>
${styles}
  <Folder>
    <name>Vehicle Routes — WGS84 (EPSG:4326)</name>
    <description>GPS-tracked vehicle routes — functional class inferred from average speed per FHWA methodology</description>
${marks}
  </Folder>
</Document>
</kml>`;
    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_roads_${fileLabel(q.from, q.to)}.kml"`);
    res.send(kml);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/gis/export/gpx ───────────────────────────────────────────────────
router.get("/api/gis/export/gpx", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const r of routes) for (const [lon, lat] of r.coordinates) {
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    }
    const trkBlocks = routes.map(r => {
      const pts = r.rawPoints.map(p =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><time>${p.ts}</time>${p.speed != null ? `<extensions><speed>${(p.speed / 3.6).toFixed(3)}</speed></extensions>` : ""}</trkpt>`
      ).join("\n");
      return `  <trk>
    <name>${escXml(r.plateNumber)} — ${r.startTime.slice(0, 10)}</name>
    <desc>${escXml(`${r.plateNumber} | ${r.driverName ?? "N/A"} | ${r.distanceKm} km | ${r.manifestCode ?? "N/A"} | ${r.districtName ?? "N/A"}`)}</desc>
    <type>vehicle_route</type>
    <extensions>
      <ROUTE_ID>${escXml(r.routeId)}</ROUTE_ID>
      <ROUTE_LEN_KM>${r.distanceKm}</ROUTE_LEN_KM>
      <AVG_SPEED_KMH>${r.avgSpeedKmh ?? ""}</AVG_SPEED_KMH>
      <MAX_SPEED_KMH>${r.maxSpeedKmh ?? ""}</MAX_SPEED_KMH>
      <BEARING_DEG>${r.dominantBearing ?? ""}</BEARING_DEG>
      <CARDINAL_DIR>${r.cardinalDir ?? ""}</CARDINAL_DIR>
      <FUNC_CLASS>${escXml(r.funcClassInferred)}</FUNC_CLASS>
      <DATA_QUALITY>${r.dataQuality}</DATA_QUALITY>
      <PING_COUNT>${r.pingCount}</PING_COUNT>
      <PING_DENSITY>${r.pingDensityPerKm}</PING_DENSITY>
      <GAP_COUNT>${r.gapCount}</GAP_COUNT>
      <DISTRICT>${escXml(r.districtName ?? "")}</DISTRICT>
      <MANIFEST_CODE>${escXml(r.manifestCode ?? "")}</MANIFEST_CODE>
      <CAPTURE_METHOD>GPS_TRACK</CAPTURE_METHOD>
      <COORD_SYS>WGS84 (EPSG:4326)</COORD_SYS>
    </extensions>
    <trkseg>
${pts}
    </trkseg>
  </trk>`;
    }).join("\n");

    const now = new Date().toISOString();
    const bl  = routes.length ? ` minlat="${minLat.toFixed(7)}" minlon="${minLon.toFixed(7)}" maxlat="${maxLat.toFixed(7)}" maxlon="${maxLon.toFixed(7)}"` : "";
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Invendis Distribution Management System"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Invendis Road Coverage — ${fileLabel(q.from, q.to)}</name>
    <desc>GPS-tracked vehicle routes. CRS: WGS84 (EPSG:4326). Speed in extensions in m/s. Quality per ISO 19157.</desc>
    <author><name>Invendis Distribution Management System</name></author>
    <time>${now}</time>
    <keywords>vehicle GPS route Sierra Leone distribution agriculture WGS84 EPSG4326</keywords>${routes.length ? `\n    <bounds${bl}/>` : ""}
  </metadata>
${trkBlocks}
</gpx>`;
    res.setHeader("Content-Type", "application/gpx+xml");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_roads_${fileLabel(q.from, q.to)}.gpx"`);
    res.send(gpx);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/gis/export/csv ───────────────────────────────────────────────────
router.get("/api/gis/export/csv", async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));
    const headers = [
      "ROUTE_ID","SURVEY_DATE","SURVEY_YEAR","VEHICLE_ID","PLATE_NO","VEHICLE_CODE",
      "DISPATCH_ID","MANIFEST_CODE","CAMPAIGN","DISTRICT","DRIVER","DISPATCH_STATUS",
      "START_TIME","END_TIME","DURATION_MIN","ROUTE_LEN_KM",
      "AVG_SPEED_KMH","MAX_SPEED_KMH","SPEED_VAR_KMH",
      "PING_COUNT","PING_DENSITY","GAP_COUNT",
      "BEARING_DEG","CARDINAL_DIR","FUNC_CLASS","DATA_QUALITY",
      "SPEED_STOPPED_PCT","SPEED_SLOW_PCT","SPEED_MODERATE_PCT","SPEED_FAST_PCT","SPEED_HIGHWAY_PCT",
      "START_LAT","START_LON","END_LAT","END_LON",
      "CAPTURE_METHOD","COORD_SYS",
    ];
    const esc = (v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = routes.map(r => {
      const startCoord = r.coordinates.at(0);
      const endCoord   = r.coordinates.at(-1);
      return [
        r.routeId, r.startTime.slice(0, 10), r.startTime.slice(0, 4),
        r.vehicleId, r.plateNumber, r.vehicleCode ?? "",
        r.dispatchId ?? "", r.manifestCode ?? "", r.campaignName ?? "",
        r.districtName ?? "", r.driverName ?? "", r.dispatchStatus ?? "",
        r.startTime, r.endTime, r.durationMinutes, r.distanceKm,
        r.avgSpeedKmh ?? "", r.maxSpeedKmh ?? "", r.speedVarianceKmh ?? "",
        r.pingCount, r.pingDensityPerKm, r.gapCount,
        r.dominantBearing ?? "", r.cardinalDir ?? "",
        r.funcClassInferred, r.dataQuality,
        r.speedBands.stopped, r.speedBands.slow, r.speedBands.moderate,
        r.speedBands.fast, r.speedBands.highway,
        startCoord ? startCoord[1] : "", startCoord ? startCoord[0] : "",
        endCoord   ? endCoord[1]   : "", endCoord   ? endCoord[0]   : "",
        "GPS_TRACK", "WGS84 (EPSG:4326)",
      ].map(esc).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_roads_${fileLabel(q.from, q.to)}.csv"`);
    res.send("\uFEFF" + csv); // BOM for Excel UTF-8
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
