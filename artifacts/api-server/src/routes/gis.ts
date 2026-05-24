import { Router } from "express";
import { requireAnyAuth } from "../lib/auth.js";
import { supa } from "../lib/supabase.js";
import { haversineMeters } from "./gps.js";

const router = Router();

const ROUTE_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#a855f7",
];

function escXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hexToKmlAbgr(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `ff${b}${g}${r}`;
}

interface RouteRecord {
  routeId: string;
  vehicleId: number;
  plateNumber: string;
  vehicleCode: string | null;
  dispatchId: number | null;
  manifestCode: string | null;
  campaignName: string | null;
  districtName: string | null;
  driverName: string | null;
  dispatchStatus: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  distanceKm: number;
  avgSpeedKmh: number | null;
  pingCount: number;
  color: string;
  coordinates: [number, number][];
  rawPoints: { lat: number; lng: number; speed: number | null; heading: number | null; ts: string }[];
}

async function buildRoutes(opts: {
  vehicleId?: number;
  dispatchId?: number;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<RouteRecord[]> {
  const { vehicleId, dispatchId, from, to, limit = 10000 } = opts;

  let query = supa
    .from("gps_track")
    .select("id, vehicle_id, dispatch_id, latitude, longitude, speed, heading, recorded_at")
    .order("recorded_at", { ascending: true })
    .limit(limit);

  if (vehicleId) query = query.eq("vehicle_id", vehicleId);
  if (dispatchId) query = query.eq("dispatch_id", dispatchId);
  if (from) query = query.gte("recorded_at", from);
  if (to) query = query.lte("recorded_at", to);

  const { data: tracks, error } = await query;
  if (error) throw new Error(error.message);
  const allTracks: any[] = tracks ?? [];
  if (!allTracks.length) return [];

  const vehicleIds = [...new Set(allTracks.map((t) => t.vehicle_id))] as number[];
  const rawDispatchIds = [...new Set(allTracks.map((t) => t.dispatch_id).filter(Boolean))] as number[];

  const [{ data: vehicles }, dispatchResult] = await Promise.all([
    supa.from("vehicles").select("id, plate_number, vehicle_code").in("id", vehicleIds),
    rawDispatchIds.length
      ? supa.from("dispatches")
          .select("id, manifest_code, campaign_id, driver_id, status, departed_at, arrived_at")
          .in("id", rawDispatchIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const vehicleMap: Record<number, any> = Object.fromEntries((vehicles ?? []).map((v: any) => [v.id, v]));
  const dispatchMeta: Record<number, any> = {};

  const dispatchRows: any[] = (dispatchResult as any).data ?? [];
  if (dispatchRows.length) {
    const campIds = [...new Set(dispatchRows.map((d) => d.campaign_id).filter(Boolean))] as number[];
    const drvIds  = [...new Set(dispatchRows.map((d) => d.driver_id).filter(Boolean))] as number[];

    const [{ data: campaigns }, { data: drivers }] = await Promise.all([
      campIds.length ? supa.from("campaigns").select("id, name, district_id").in("id", campIds) : Promise.resolve({ data: [] as any[] }),
      drvIds.length  ? supa.from("drivers").select("id, full_name").in("id", drvIds)           : Promise.resolve({ data: [] as any[] }),
    ]);

    const distIds = [...new Set((campaigns ?? []).map((c: any) => c.district_id).filter(Boolean))] as number[];
    const { data: districts } = distIds.length
      ? await supa.from("districts").select("id, name").in("id", distIds)
      : { data: [] as any[] };

    const campMap     = Object.fromEntries((campaigns ?? []).map((c: any) => [c.id, c]));
    const driverMap   = Object.fromEntries((drivers ?? []).map((d: any) => [d.id, d]));
    const districtMap = Object.fromEntries((districts ?? []).map((d: any) => [d.id, d]));

    for (const d of dispatchRows) {
      const camp = d.campaign_id ? campMap[d.campaign_id] : null;
      const dist = camp?.district_id ? districtMap[camp.district_id] : null;
      dispatchMeta[d.id] = {
        manifestCode: d.manifest_code ?? null,
        campaignName: camp?.name ?? null,
        districtName: dist?.name ?? null,
        driverName: d.driver_id ? driverMap[d.driver_id]?.full_name ?? null : null,
        status: d.status ?? null,
      };
    }
  }

  const groups = new Map<string, any[]>();
  for (const t of allTracks) {
    const dateStr = t.recorded_at.slice(0, 10);
    const key = `${t.vehicle_id}:${t.dispatch_id ?? dateStr}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const vehicleColorIdx = new Map<number, number>();
  let colorCounter = 0;
  const routes: RouteRecord[] = [];

  for (const pts of groups.values()) {
    if (pts.length < 2) continue;

    const first = pts[0];
    const last  = pts[pts.length - 1];
    const veh   = vehicleMap[first.vehicle_id];
    const dmeta = first.dispatch_id ? dispatchMeta[first.dispatch_id] ?? {} : {};

    let distM = 0, speedSum = 0, speedN = 0;
    for (let i = 1; i < pts.length; i++) {
      distM += haversineMeters(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
      if (pts[i].speed != null && pts[i].speed > 0) { speedSum += Number(pts[i].speed); speedN++; }
    }

    const startTime = new Date(first.recorded_at);
    const endTime   = new Date(last.recorded_at);
    const durMs     = endTime.getTime() - startTime.getTime();

    if (!vehicleColorIdx.has(first.vehicle_id)) {
      vehicleColorIdx.set(first.vehicle_id, colorCounter % ROUTE_COLORS.length);
      colorCounter++;
    }
    const color = ROUTE_COLORS[vehicleColorIdx.get(first.vehicle_id)!];

    const dateKey = startTime.toISOString().slice(0, 10);
    routes.push({
      routeId:        `${first.vehicle_id}-${first.dispatch_id ?? dateKey}`,
      vehicleId:      first.vehicle_id,
      plateNumber:    veh?.plate_number ?? `VEH-${first.vehicle_id}`,
      vehicleCode:    veh?.vehicle_code ?? null,
      dispatchId:     first.dispatch_id ?? null,
      manifestCode:   dmeta.manifestCode ?? null,
      campaignName:   dmeta.campaignName ?? null,
      districtName:   dmeta.districtName ?? null,
      driverName:     dmeta.driverName ?? null,
      dispatchStatus: dmeta.status ?? null,
      startTime:      startTime.toISOString(),
      endTime:        endTime.toISOString(),
      durationMinutes: Math.round(durMs / 60000),
      distanceKm:     Math.round(distM / 10) / 100,
      avgSpeedKmh:    speedN > 0 ? Math.round(speedSum / speedN) : null,
      pingCount:      pts.length,
      color,
      coordinates:    pts.map((p: any) => [Number(p.longitude), Number(p.latitude)]),
      rawPoints:      pts.map((p: any) => ({
        lat:     Number(p.latitude),
        lng:     Number(p.longitude),
        speed:   p.speed ?? null,
        heading: p.heading ?? null,
        ts:      p.recorded_at,
      })),
    });
  }

  return routes.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

function parseOpts(q: Record<string, string>) {
  return {
    vehicleId:  q.vehicleId  ? Number(q.vehicleId)  : undefined,
    dispatchId: q.dispatchId ? Number(q.dispatchId) : undefined,
    from:       q.from  || undefined,
    to:         q.to    || undefined,
    limit:      q.limit ? Number(q.limit) : undefined,
  };
}

function fileLabel(from?: string, to?: string) {
  const parts = [from?.slice(0, 10), to?.slice(0, 10)].filter(Boolean);
  return parts.length ? parts.join("_to_") : new Date().toISOString().slice(0, 10);
}

router.get("/api/gis/routes", requireAnyAuth, async (req, res) => {
  try {
    const routes = await buildRoutes(parseOpts(req.query as Record<string, string>));
    res.json(routes.map(r => { const { rawPoints: _r, ...rest } = r; return rest; }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/gis/export/geojson", requireAnyAuth, async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));
    const totalKm = routes.reduce((s, r) => s + r.distanceKm, 0);

    const body = {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
      metadata: {
        title: "Invendis Road Coverage Report",
        generated: new Date().toISOString(),
        source: "Invendis Distribution Management System",
        coordinateSystem: "WGS84 (EPSG:4326)",
        totalRoutes: routes.length,
        totalDistanceKm: Math.round(totalKm * 100) / 100,
      },
      features: routes.map(r => ({
        type: "Feature",
        id: r.routeId,
        geometry: { type: "LineString", coordinates: r.coordinates },
        properties: {
          routeId:         r.routeId,
          vehicleId:       r.vehicleId,
          plateNumber:     r.plateNumber,
          vehicleCode:     r.vehicleCode,
          dispatchId:      r.dispatchId,
          manifestCode:    r.manifestCode,
          campaignName:    r.campaignName,
          districtName:    r.districtName,
          driverName:      r.driverName,
          dispatchStatus:  r.dispatchStatus,
          startTime:       r.startTime,
          endTime:         r.endTime,
          durationMinutes: r.durationMinutes,
          distanceKm:      r.distanceKm,
          avgSpeedKmh:     r.avgSpeedKmh,
          pingCount:       r.pingCount,
          coordinateSystem: "WGS84 (EPSG:4326)",
        },
      })),
    };

    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_routes_${fileLabel(q.from, q.to)}.geojson"`);
    res.json(body);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/gis/export/kml", requireAnyAuth, async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));

    const vehicleColors = new Map<number, string>();
    for (const r of routes) if (!vehicleColors.has(r.vehicleId)) vehicleColors.set(r.vehicleId, r.color);

    const styles = [...vehicleColors.entries()].map(([vId, hex]) =>
      `  <Style id="v${vId}"><LineStyle><color>${hexToKmlAbgr(hex)}</color><width>3</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`
    ).join("\n");

    const marks = routes.map(r => {
      const dH = Math.floor(r.durationMinutes / 60);
      const dM = r.durationMinutes % 60;
      return `  <Placemark>
    <name>${escXml(r.plateNumber)} — ${r.startTime.slice(0, 10)}</name>
    <description><![CDATA[<b>Vehicle:</b> ${escXml(r.plateNumber)}<br/><b>Driver:</b> ${escXml(r.driverName ?? "N/A")}<br/><b>Manifest:</b> ${escXml(r.manifestCode ?? "N/A")}<br/><b>Campaign:</b> ${escXml(r.campaignName ?? "N/A")}<br/><b>District:</b> ${escXml(r.districtName ?? "N/A")}<br/><b>Date:</b> ${r.startTime.slice(0, 10)}<br/><b>Duration:</b> ${dH}h ${dM}m<br/><b>Distance:</b> ${r.distanceKm} km<br/><b>Avg Speed:</b> ${r.avgSpeedKmh ?? "N/A"} km/h<br/><b>GPS Pings:</b> ${r.pingCount}<br/><b>CRS:</b> WGS84 (EPSG:4326)]]></description>
    <styleUrl>#v${r.vehicleId}</styleUrl>
    <TimeSpan><begin>${r.startTime}</begin><end>${r.endTime}</end></TimeSpan>
    <LineString>
      <tessellate>1</tessellate>
      <altitudeMode>clampToGround</altitudeMode>
      <coordinates>${r.coordinates.map(c => `${c[0]},${c[1]},0`).join(" ")}</coordinates>
    </LineString>
    <ExtendedData>
      <Data name="vehicleId"><value>${r.vehicleId}</value></Data>
      <Data name="plateNumber"><value>${escXml(r.plateNumber)}</value></Data>
      <Data name="manifestCode"><value>${escXml(r.manifestCode ?? "")}</value></Data>
      <Data name="districtName"><value>${escXml(r.districtName ?? "")}</value></Data>
      <Data name="distanceKm"><value>${r.distanceKm}</value></Data>
      <Data name="pingCount"><value>${r.pingCount}</value></Data>
      <Data name="coordinateSystem"><value>WGS84 (EPSG:4326)</value></Data>
    </ExtendedData>
  </Placemark>`;
    }).join("\n");

    const now = new Date().toISOString();
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>Invendis Road Coverage Report</name>
  <description>Generated: ${now} | Routes: ${routes.length} | Source: Invendis Distribution Management System | CRS: WGS84 (EPSG:4326)</description>
  <open>1</open>
${styles}
  <Folder>
    <name>Vehicle Routes — WGS84 (EPSG:4326)</name>
    <description>All recorded vehicle routes exported from Invendis</description>
${marks}
  </Folder>
</Document>
</kml>`;

    res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_routes_${fileLabel(q.from, q.to)}.kml"`);
    res.send(kml);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/gis/export/gpx", requireAnyAuth, async (req, res) => {
  try {
    const q = req.query as Record<string, string>;
    const routes = await buildRoutes(parseOpts(q));

    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const r of routes) {
      for (const [lon, lat] of r.coordinates) {
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      }
    }

    const tracks = routes.map(r => {
      const pts = r.rawPoints.map(p =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><time>${p.ts}</time>${p.speed != null ? `<extensions><speed>${(p.speed / 3.6).toFixed(2)}</speed></extensions>` : ""}</trkpt>`
      ).join("\n");
      return `  <trk>
    <name>${escXml(r.plateNumber)} — ${r.startTime.slice(0, 10)}</name>
    <desc>${escXml(`Vehicle: ${r.plateNumber} | Driver: ${r.driverName ?? "N/A"} | Distance: ${r.distanceKm} km | Manifest: ${r.manifestCode ?? "N/A"} | District: ${r.districtName ?? "N/A"}`)}</desc>
    <type>vehicle_route</type>
    <extensions>
      <distanceKm>${r.distanceKm}</distanceKm>
      <avgSpeedKmh>${r.avgSpeedKmh ?? ""}</avgSpeedKmh>
      <vehicleId>${r.vehicleId}</vehicleId>
      <dispatchId>${r.dispatchId ?? ""}</dispatchId>
      <manifestCode>${escXml(r.manifestCode ?? "")}</manifestCode>
      <districtName>${escXml(r.districtName ?? "")}</districtName>
      <coordinateSystem>WGS84 (EPSG:4326)</coordinateSystem>
    </extensions>
    <trkseg>
${pts}
    </trkseg>
  </trk>`;
    }).join("\n");

    const now = new Date().toISOString();
    const boundsAttr = routes.length
      ? ` minlat="${minLat.toFixed(7)}" minlon="${minLon.toFixed(7)}" maxlat="${maxLat.toFixed(7)}" maxlon="${maxLon.toFixed(7)}"`
      : "";

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Invendis Distribution Management System"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Invendis Road Coverage — ${fileLabel(q.from, q.to)}</name>
    <desc>Vehicle GPS route data exported from Invendis Distribution Management System. Coordinate system: WGS84 (EPSG:4326)</desc>
    <author><name>Invendis</name></author>
    <time>${now}</time>
    <keywords>vehicle GPS route Sierra Leone distribution agriculture WGS84</keywords>${routes.length ? `\n    <bounds${boundsAttr}/>` : ""}
  </metadata>
${tracks}
</gpx>`;

    res.setHeader("Content-Type", "application/gpx+xml");
    res.setHeader("Content-Disposition", `attachment; filename="invendis_routes_${fileLabel(q.from, q.to)}.gpx"`);
    res.send(gpx);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
