import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { listGpsRoutes, listVehicles, buildGisExportUrl, KEYS } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import {
  Map as MapIcon, Route, RefreshCw, Truck, Navigation,
  Clock, Ruler, Gauge, Calendar, FileText, Globe,
  MapPin, Layers, ArrowDownToLine, BarChart2, Info,
  ChevronDown, ChevronRight, Table2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type ColorMode   = "vehicle" | "speed" | "quality";
type BaseLayerId = "hot" | "osm" | "satellite" | "topo";
type BottomTab   = "table" | "analytics" | "reference";

// ── Base-layer configs ─────────────────────────────────────────────────────────
const BASE_LAYERS: Record<BaseLayerId, { url: string; attribution: string; label: string }> = {
  hot: {
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles courtesy of <a href="https://www.hotosm.org/">HOT</a>',
    label: "HOT Humanitarian",
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    label: "Street Map",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, DigitalGlobe, GeoEye, USDA, USGS, AeroGRID, IGN",
    label: "Satellite (Esri)",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data &copy; <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
    label: "Topographic",
  },
};

// ── Speed colour scale (ArcGIS traffic-layer standard) ────────────────────────
const SPEED_SCALE = [
  { label: "> 85 km/h",  sublabel: "Highway",     color: "#3b82f6", min: 85 },
  { label: "65–85",      sublabel: "Fast",         color: "#22c55e", min: 65 },
  { label: "50–65",      sublabel: "Moderate",     color: "#84cc16", min: 50 },
  { label: "35–50",      sublabel: "Slow",         color: "#eab308", min: 35 },
  { label: "20–35",      sublabel: "Very Slow",    color: "#f97316", min: 20 },
  { label: "< 20 km/h",  sublabel: "Stop & Go",   color: "#ef4444", min: 0  },
];

const QUALITY_SCALE = [
  { label: "EXCELLENT", sub: "≥10 pings/km", color: "#22c55e" },
  { label: "GOOD",      sub: "5–10",          color: "#84cc16" },
  { label: "FAIR",      sub: "2–5",           color: "#f59e0b" },
  { label: "POOR",      sub: "< 2",           color: "#ef4444" },
];

const SL_CENTER: [number, number] = [8.5, -11.8];

// ── Colour utilities ──────────────────────────────────────────────────────────
function speedToColor(s: number | null): string {
  if (s == null) return "#94a3b8";
  if (s < 10)  return "#dc2626";
  if (s < 20)  return "#ef4444";
  if (s < 35)  return "#f97316";
  if (s < 50)  return "#eab308";
  if (s < 65)  return "#84cc16";
  if (s < 85)  return "#22c55e";
  return "#3b82f6";
}
function qualityColor(q: string): string {
  return ({ EXCELLENT: "#22c55e", GOOD: "#84cc16", FAIR: "#f59e0b", POOR: "#ef4444" } as any)[q] ?? "#94a3b8";
}
function getRouteColor(r: any, mode: ColorMode): string {
  if (mode === "speed")   return r.speedColor  ?? speedToColor(r.avgSpeedKmh);
  if (mode === "quality") return r.qualityColor ?? qualityColor(r.dataQuality);
  return r.color ?? "#3b82f6";
}

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtDur(m: number) { return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Map helpers ────────────────────────────────────────────────────────────────
function FitBoundsToRoutes({ routes }: { routes: any[] }) {
  const map = useMap();
  const key = routes.map(r => r.routeId).join(",");
  useEffect(() => {
    const pts: [number, number][] = [];
    for (const r of routes)
      for (const [lng, lat] of (r.coordinates ?? [])) pts.push([lat, lng]);
    if (pts.length >= 2) {
      try { map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 13 }); } catch { /* */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ScaleControl() {
  const map = useMap();
  useEffect(() => {
    const ctrl = L.control.scale({ metric: true, imperial: false, position: "bottomright" });
    ctrl.addTo(map);
    return () => { ctrl.remove(); };
  }, [map]);
  return null;
}

/** Per-segment speed-heat polylines (ArcGIS traffic-layer approach) */
function SpeedSegments({ route, isSelected, onSelect }: {
  route: any; isSelected: boolean; onSelect: () => void;
}) {
  const pts: { lat: number; lng: number; speed: number | null }[] = route.speedPoints ?? [];
  if (pts.length < 2) return null;
  return (
    <>
      {pts.slice(0, -1).map((p, i) => {
        const nx = pts[i + 1];
        return (
          <Polyline
            key={`${route.routeId}-${i}`}
            positions={[[p.lat, p.lng], [nx.lat, nx.lng]]}
            pathOptions={{ color: speedToColor(p.speed), weight: isSelected ? 5 : 3, opacity: 0.9 }}
            eventHandlers={{ click: onSelect }}
          />
        );
      })}
      {/* Transparent thick overlay for reliable click + popup */}
      <Polyline
        positions={pts.map(p => [p.lat, p.lng])}
        pathOptions={{ opacity: 0, weight: 12 }}
        eventHandlers={{ click: onSelect }}
      >
        <Popup><RoutePopup r={route} /></Popup>
      </Polyline>
    </>
  );
}

function RoutePopup({ r }: { r: any }) {
  return (
    <div className="min-w-[230px] py-0.5 space-y-1.5 text-sm">
      <p className="font-bold text-base leading-tight">{r.plateNumber}</p>
      {r.driverName   && <p className="text-xs text-gray-500">{r.driverName}</p>}
      {r.manifestCode && <p className="font-mono text-xs text-gray-600">📋 {r.manifestCode}</p>}
      {r.districtName && <p className="text-xs">📍 {r.districtName}</p>}
      {r.campaignName && <p className="text-xs text-gray-600">🌾 {r.campaignName}</p>}
      <div className="border-t pt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>📅 {fmtDate(r.startTime)}</span>
        <span>⏱ {fmtDur(r.durationMinutes)}</span>
        <span>📏 {r.distanceKm} km</span>
        <span>💨 avg {r.avgSpeedKmh ?? "—"} km/h</span>
        <span>🔺 max {r.maxSpeedKmh ?? "—"} km/h</span>
        <span>📡 {r.pingCount} pings</span>
        <span>🧭 {r.dominantBearing ?? "—"}° {r.cardinalDir ?? ""}</span>
        <span>🛣 {(r.funcClassInferred ?? "").split("/")[0]}</span>
        <span>📊 {r.pingDensityPerKm} p/km</span>
        <span>⚠ {r.gapCount} gaps</span>
      </div>
      <div className="pt-0.5 flex items-center gap-1.5">
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: qualityColor(r.dataQuality) + "25", color: qualityColor(r.dataQuality) }}
        >
          {r.dataQuality}
        </span>
        <span className="text-[10px] text-gray-500">ISO 19157</span>
      </div>
    </div>
  );
}

function RouteMap({ routes, selectedId, onSelect, baseLayer, colorMode }: {
  routes: any[]; selectedId: string | null;
  onSelect: (id: string | null) => void;
  baseLayer: BaseLayerId; colorMode: ColorMode;
}) {
  const bl = BASE_LAYERS[baseLayer];
  return (
    <MapContainer center={SL_CENTER} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer key={baseLayer} url={bl.url} attribution={bl.attribution} maxZoom={19} />
      <FitBoundsToRoutes routes={routes} />
      <ScaleControl />
      {routes.map(r => {
        const sel = selectedId === r.routeId;
        if (colorMode === "speed") {
          return <SpeedSegments key={r.routeId} route={r} isSelected={sel} onSelect={() => onSelect(sel ? null : r.routeId)} />;
        }
        const pts: [number, number][] = (r.coordinates ?? []).map(([lng, lat]: number[]) => [lat, lng]);
        if (pts.length < 2) return null;
        return (
          <Polyline
            key={r.routeId}
            positions={pts}
            pathOptions={{ color: getRouteColor(r, colorMode), weight: sel ? 6 : 3, opacity: sel ? 1 : 0.78 }}
            eventHandlers={{ click: () => onSelect(sel ? null : r.routeId) }}
          >
            <Popup><RoutePopup r={r} /></Popup>
          </Polyline>
        );
      })}
    </MapContainer>
  );
}

// ── Quality badge ──────────────────────────────────────────────────────────────
function QBadge({ q }: { q: string }) {
  const cls: Record<string, string> = {
    EXCELLENT: "bg-emerald-100 text-emerald-700",
    GOOD:      "bg-lime-100 text-lime-700",
    FAIR:      "bg-amber-100 text-amber-700",
    POOR:      "bg-red-100 text-red-700",
  };
  return <span className={`text-[9px] font-bold px-1.5 py-0 rounded ${cls[q] ?? "bg-gray-100 text-gray-600"}`}>{q}</span>;
}

// ── Route list item ────────────────────────────────────────────────────────────
function RouteListItem({ r, isSelected, onSelect, colorMode }: {
  r: any; isSelected: boolean; onSelect: () => void; colorMode: ColorMode;
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer border transition-all ${
        isSelected ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" : "border-transparent hover:bg-muted/50"
      }`}
    >
      <div className="shrink-0 w-3 h-3 rounded-sm mt-0.5" style={{ background: getRouteColor(r, colorMode) }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-xs">{r.plateNumber}</span>
          <QBadge q={r.dataQuality} />
        </div>
        {r.driverName   && <p className="text-[10px] text-muted-foreground truncate">{r.driverName}</p>}
        {r.districtName && <p className="text-[10px] text-muted-foreground/60">{r.districtName}</p>}
        <div className="flex flex-wrap gap-2.5 mt-0.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Calendar className="h-2.5 w-2.5" />{fmtDate(r.startTime)}</span>
          <span className="flex items-center gap-0.5"><Ruler className="h-2.5 w-2.5" />{r.distanceKm} km</span>
          <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{fmtDur(r.durationMinutes)}</span>
          {r.avgSpeedKmh && <span className="flex items-center gap-0.5"><Gauge className="h-2.5 w-2.5" />{r.avgSpeedKmh} km/h</span>}
        </div>
      </div>
    </div>
  );
}

// ── Speed analytics chart ──────────────────────────────────────────────────────
function SpeedBandsChart({ routes }: { routes: any[] }) {
  const data = useMemo(() => {
    if (!routes.length) return [];
    const n = routes.length;
    const avg = (key: string) => Math.round(routes.reduce((s, r) => s + (r.speedBands?.[key] ?? 0), 0) / n);
    return [
      { name: "Highway\n>85",    pct: avg("highway"),  color: "#3b82f6" },
      { name: "Fast\n65–85",     pct: avg("fast"),     color: "#22c55e" },
      { name: "Moderate\n35–65", pct: avg("moderate"), color: "#eab308" },
      { name: "Slow\n20–35",     pct: avg("slow"),     color: "#f97316" },
      { name: "Stopped\n<20",    pct: avg("stopped"),  color: "#ef4444" },
    ];
  }, [routes]);

  if (!data.length) return <p className="text-xs text-muted-foreground py-6 text-center">No speed data available.</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold">Speed Band Distribution — avg % of travel time across all routes</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 32, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" />
          <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} height={44} />
          <YAxis unit="%" tick={{ fontSize: 10 }} width={28} />
          <Tooltip formatter={(v) => [`${v}%`, "Avg %"]} contentStyle={{ fontSize: 11 }} />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
            {data.map(d => <Cell key={d.name} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-muted-foreground">
        Colour scale per ArcGIS Traffic Layer standard. Green = free-flow / good road condition. Red = stop-and-go / poor road.
      </p>
    </div>
  );
}

function QualityDistChart({ routes }: { routes: any[] }) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of routes) counts[r.dataQuality] = (counts[r.dataQuality] ?? 0) + 1;
    return QUALITY_SCALE.map(q => ({ name: q.label, count: counts[q.label] ?? 0, color: q.color }));
  }, [routes]);

  if (!routes.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold">Data Quality Distribution (ISO 19157 — routes by ping density)</p>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={56} />
          <Tooltip formatter={(v) => [`${v} routes`, ""]} contentStyle={{ fontSize: 11 }} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]}>
            {data.map(d => <Cell key={d.name} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sortable route attribute table ────────────────────────────────────────────
type SortCol = "startTime" | "distanceKm" | "durationMinutes" | "avgSpeedKmh" |
               "pingDensityPerKm" | "dataQuality" | "dominantBearing";
type SortDir = "asc" | "desc";

function RouteAttributeTable({ routes, onSelect }: { routes: any[]; onSelect: (id: string) => void }) {
  const [col, setCol] = useState<SortCol>("startTime");
  const [dir, setDir] = useState<SortDir>("desc");

  function sort(c: SortCol) {
    if (col === c) setDir(d => d === "asc" ? "desc" : "asc");
    else { setCol(c); setDir("asc"); }
  }

  const sorted = useMemo(() => {
    const rank: Record<string, number> = { EXCELLENT: 4, GOOD: 3, FAIR: 2, POOR: 1 };
    return [...routes].sort((a, b) => {
      let av: any = a[col], bv: any = b[col];
      if (col === "startTime") { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (col === "dataQuality") { av = rank[av] ?? 0; bv = rank[bv] ?? 0; }
      if (av == null) return 1; if (bv == null) return -1;
      return dir === "asc" ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
  }, [routes, col, dir]);

  const Th = ({ c, label }: { c: SortCol; label: string }) => (
    <th
      onClick={() => sort(c)}
      className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-2 py-2 cursor-pointer hover:text-foreground whitespace-nowrap select-none"
    >
      {label}{col === c ? (dir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
  const Th2 = ({ label }: { label: string }) => (
    <th className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-2 py-2 whitespace-nowrap">{label}</th>
  );

  if (!routes.length) return <p className="text-xs text-muted-foreground py-6 text-center">No routes to display.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead className="border-b bg-muted/30 sticky top-0">
          <tr>
            <Th2 label="PLATE_NO" />
            <Th c="startTime" label="SURVEY_DATE" />
            <Th2 label="DISTRICT" />
            <Th c="distanceKm" label="KM" />
            <Th c="durationMinutes" label="DURATION" />
            <Th c="avgSpeedKmh" label="AVG KMH" />
            <Th2 label="MAX KMH" />
            <Th2 label="SPEED_VAR" />
            <Th c="dominantBearing" label="BEARING" />
            <Th2 label="CARDINAL" />
            <Th2 label="FUNC_CLASS" />
            <Th c="pingDensityPerKm" label="PINGS/KM" />
            <Th2 label="GAPS" />
            <Th c="dataQuality" label="QUALITY" />
            <Th2 label="DRIVER" />
            <Th2 label="MANIFEST" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => (
            <tr
              key={r.routeId}
              className="border-b hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => onSelect(r.routeId)}
            >
              <td className="px-2 py-1.5 font-semibold">{r.plateNumber}</td>
              <td className="px-2 py-1.5 whitespace-nowrap font-mono">{r.startTime.slice(0, 10)}</td>
              <td className="px-2 py-1.5">{r.districtName ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono">{r.distanceKm}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{fmtDur(r.durationMinutes)}</td>
              <td className="px-2 py-1.5 font-mono">{r.avgSpeedKmh ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono">{r.maxSpeedKmh ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono">{r.speedVarianceKmh != null ? `±${r.speedVarianceKmh}` : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{r.dominantBearing != null ? `${r.dominantBearing}°` : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{r.cardinalDir ?? "—"}</td>
              <td className="px-2 py-1.5">
                <span className="text-[9px] px-1 py-0 rounded bg-slate-100 text-slate-700 whitespace-nowrap">
                  {(r.funcClassInferred ?? "").split("/")[0].trim()}
                </span>
              </td>
              <td className="px-2 py-1.5 font-mono">{r.pingDensityPerKm}</td>
              <td className="px-2 py-1.5 font-mono">{r.gapCount}</td>
              <td className="px-2 py-1.5"><QBadge q={r.dataQuality} /></td>
              <td className="px-2 py-1.5 max-w-[90px] truncate">{r.driverName ?? "—"}</td>
              <td className="px-2 py-1.5 font-mono text-[10px]">{r.manifestCode ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── GIS Reference Panel ────────────────────────────────────────────────────────
function GisReferencePanel() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
      <div>
        <p className="font-semibold mb-2 text-sm">Coordinate Reference System</p>
        <dl className="space-y-1 text-muted-foreground">
          {[
            ["System",        "Geographic (lat / lon)"],
            ["Datum",         "WGS 1984"],
            ["EPSG",          "4326"],
            ["OGC URN",       "urn:ogc:def:crs:OGC:1.3:CRS84"],
            ["GeoJSON order", "[longitude, latitude]"],
            ["Unit",          "Decimal degrees"],
            ["Ellipsoid",     "GRS 1980 (WGS84)"],
            ["Prime meridian","Greenwich"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-28 shrink-0 font-medium">{k}:</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <p className="font-semibold mb-2 text-sm">Data Quality (ISO 19157)</p>
        <p className="text-muted-foreground mb-2 text-[10px]">
          Ping density (GPS observations per km) is the primary completeness metric per FHWA road-centerline guidance.
        </p>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left pb-1 font-semibold">Rating</th>
              <th className="text-right pb-1 font-semibold">Pings/km</th>
              <th className="text-right pb-1 font-semibold">Use</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["EXCELLENT","≥ 10","Centerline survey-grade"],
              ["GOOD",     "5–10","Primary road mapping"],
              ["FAIR",     "2–5", "Indicative mapping"],
              ["POOR",     "< 2", "Existence only"],
            ].map(([q, v, use]) => (
              <tr key={q} className="border-b last:border-0">
                <td className="py-1 font-bold" style={{ color: qualityColor(q) }}>{q}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">{v}</td>
                <td className="py-1 text-right text-muted-foreground">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="font-semibold mt-3 mb-1 text-sm">Export Standards</p>
        <table className="w-full">
          <thead><tr className="border-b"><th className="text-left pb-1">Format</th><th className="text-right pb-1">Standard</th></tr></thead>
          <tbody>
            {[
              ["GeoJSON", "RFC 7946"],
              ["KML",     "OGC KML 2.2"],
              ["GPX",     "GPX 1.1"],
              ["CSV",     "UTF-8 + BOM (Excel-safe)"],
            ].map(([f, s]) => (
              <tr key={f} className="border-b last:border-0">
                <td className="py-1 font-medium">{f}</td>
                <td className="py-1 text-right text-muted-foreground">{s}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="font-semibold mb-2 text-sm">Functional Class (FHWA-adapted)</p>
        <p className="text-muted-foreground mb-2 text-[10px]">
          Average speed used as functional class proxy where road inventory data is unavailable. Based on AASHTO design speed guidance.
        </p>
        <table className="w-full">
          <thead><tr className="border-b"><th className="text-left pb-1">Class</th><th className="text-right pb-1">Avg Speed</th></tr></thead>
          <tbody>
            {[
              ["Highway / Trunk Road",       "> 80 km/h"],
              ["Primary Road",               "61–80"],
              ["Secondary / Collector Road", "41–60"],
              ["Local / Rural Road",         "21–40"],
              ["Track / Earth Path",         "≤ 20"],
            ].map(([c, v]) => (
              <tr key={c} className="border-b last:border-0">
                <td className="py-1">{c}</td>
                <td className="py-1 text-right font-mono text-muted-foreground">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[9px] text-muted-foreground mt-2">
          Speed variance (±σ km/h) indicates surface roughness or stop-and-go congestion. High variance on slow roads → likely earth/gravel surface.
        </p>
      </div>
    </div>
  );
}

// ── Export download ────────────────────────────────────────────────────────────
async function triggerExportDownload(
  format: "geojson" | "kml" | "gpx" | "csv",
  params: { vehicleId?: number; from?: string; to?: string },
  toast: ReturnType<typeof useToast>["toast"],
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) { toast({ title: "Not authenticated", variant: "destructive" }); return; }
  const url = buildGisExportUrl(format, params);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    toast({ title: "Export failed", description: (err as any).error ?? resp.statusText, variant: "destructive" });
    return;
  }
  const blob    = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = blobUrl;
  const cd      = resp.headers.get("Content-Disposition") ?? "";
  const match   = cd.match(/filename="([^"]+)"/);
  const exts    = { geojson: ".geojson", kml: ".kml", gpx: ".gpx", csv: ".csv" };
  a.download    = match?.[1] ?? `invendis_roads${exts[format]}`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(blobUrl);
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RoadMapping() {
  const { toast } = useToast();

  const todayStr    = () => new Date().toISOString().slice(0, 10);
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10); };

  const [fromDate,       setFromDate]       = useState(defaultFrom);
  const [toDate,         setToDate]         = useState(todayStr);
  const [vehicleFilter,  setVehicleFilter]  = useState<number | "">("");
  const [selectedRoute,  setSelectedRoute]  = useState<string | null>(null);
  const [colorMode,      setColorMode]      = useState<ColorMode>("vehicle");
  const [baseLayer,      setBaseLayer]      = useState<BaseLayerId>("hot");
  const [bottomTab,      setBottomTab]      = useState<BottomTab>("table");
  const [exporting,      setExporting]      = useState<string | null>(null);
  const [showFilters,    setShowFilters]    = useState(true);

  const queryParams = useMemo(() => ({
    vehicleId: vehicleFilter || undefined,
    from: fromDate || undefined,
    to:   toDate   || undefined,
  }), [vehicleFilter, fromDate, toDate]);

  const { data: routes, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["gis-routes", queryParams],
    queryFn:  () => listGpsRoutes(queryParams),
    staleTime: 60_000,
  });

  const { data: vehiclesResp } = useQuery({
    queryKey: KEYS.vehicles(),
    queryFn:  () => listVehicles(1, 200),
  });

  const routeList:  any[]  = Array.isArray(routes) ? routes : [];
  const vehicleList: any[] = (vehiclesResp as any)?.data ?? [];
  const selectedData = routeList.find(r => r.routeId === selectedRoute);

  const totalKm         = useMemo(() => Math.round(routeList.reduce((s, r) => s + (r.distanceKm ?? 0), 0) * 10) / 10, [routeList]);
  const uniqueVehicles  = useMemo(() => new Set(routeList.map(r => r.vehicleId)).size, [routeList]);
  const uniqueDistricts = useMemo(() => new Set(routeList.map(r => r.districtName).filter(Boolean)).size, [routeList]);
  const avgPingDensity  = useMemo(() => {
    if (!routeList.length) return 0;
    return Math.round(routeList.reduce((s, r) => s + (r.pingDensityPerKm ?? 0), 0) / routeList.length * 10) / 10;
  }, [routeList]);

  async function doExport(fmt: "geojson" | "kml" | "gpx" | "csv") {
    setExporting(fmt);
    try { await triggerExportDownload(fmt, queryParams as any, toast); }
    finally { setExporting(null); }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="GIS Road Mapping"
        subtitle="Professional vehicle route mapping — WGS84 (EPSG:4326) · ISO 19157 data quality · FHWA functional classification"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Routes",      value: routeList.length,  icon: Route,      bg: "bg-blue-50 dark:bg-blue-950/30",    tx: "text-blue-700" },
          { label: "Total km",    value: totalKm,            icon: Ruler,      bg: "bg-emerald-50 dark:bg-emerald-950/30", tx: "text-emerald-700" },
          { label: "Vehicles",    value: uniqueVehicles,    icon: Truck,      bg: "bg-violet-50 dark:bg-violet-950/30", tx: "text-violet-700" },
          { label: "Districts",   value: uniqueDistricts,   icon: MapPin,     bg: "bg-teal-50 dark:bg-teal-950/30",    tx: "text-teal-700" },
          { label: "Avg pings/km",value: avgPingDensity,    icon: Navigation, bg: "bg-amber-50 dark:bg-amber-950/30",  tx: "text-amber-700" },
        ].map(s => (
          <Card key={s.label} className={`${s.bg} border-transparent`}>
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white/60 flex items-center justify-center shrink-0">
                <s.icon className={`h-4 w-4 ${s.tx}`} />
              </div>
              <div>
                <p className={`text-lg font-bold leading-none ${s.tx}`}>{isLoading ? "—" : s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Main layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

        {/* Left panel */}
        <div className="lg:col-span-1 space-y-3">

          {/* Filters */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <button className="flex items-center gap-2 w-full text-left" onClick={() => setShowFilters(f => !f)}>
                <CardTitle className="text-sm font-semibold flex-1">Filters</CardTitle>
                {showFilters ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </CardHeader>
            {showFilters && (
              <CardContent className="pt-0 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vehicle</label>
                  <select value={String(vehicleFilter)} onChange={e => setVehicleFilter(e.target.value ? Number(e.target.value) : "")}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">All vehicles</option>
                    {vehicleList.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.plateNumber ?? v.plate_number ?? `#${v.id}`}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => refetch()}>Apply</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setFromDate(defaultFrom()); setToDate(todayStr()); setVehicleFilter(""); }}>
                    Reset
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Map controls */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />Map Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Base Layer</label>
                <div className="grid grid-cols-2 gap-1">
                  {(Object.entries(BASE_LAYERS) as [BaseLayerId, { label: string }][]).map(([id, cfg]) => (
                    <button
                      key={id}
                      onClick={() => setBaseLayer(id)}
                      className={`text-[10px] px-2 py-1.5 rounded border transition-all ${
                        baseLayer === id ? "border-blue-400 bg-blue-50 text-blue-700 font-semibold" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Colour Mode</label>
                <div className="space-y-1">
                  {([
                    ["vehicle", "By Vehicle", "Distinct colour per vehicle"],
                    ["speed",   "By Speed ▸ heatmap", "ArcGIS speed scale per segment"],
                    ["quality", "By Data Quality", "ISO 19157 quality rating"],
                  ] as [ColorMode, string, string][]).map(([m, label, sub]) => (
                    <button
                      key={m}
                      onClick={() => setColorMode(m)}
                      className={`w-full text-left px-2 py-1.5 rounded border transition-all ${
                        colorMode === m ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <p className={`text-[10px] font-semibold ${colorMode === m ? "text-blue-700" : ""}`}>{label}</p>
                      <p className="text-[9px] text-muted-foreground">{sub}</p>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Route list */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Route className="h-3.5 w-3.5 text-muted-foreground" />Routes
                {!isLoading && <span className="ml-auto text-xs text-muted-foreground font-normal">{routeList.length}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : error ? (
                <p className="text-xs text-destructive py-3">{(error as Error).message}</p>
              ) : routeList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                  <MapIcon className="h-8 w-8 opacity-20" />
                  <p className="text-sm text-center">No routes in this date range</p>
                </div>
              ) : (
                <div className="space-y-0.5 max-h-[420px] overflow-y-auto -mx-1 px-1">
                  {routeList.map(r => (
                    <RouteListItem key={r.routeId} r={r}
                      isSelected={selectedRoute === r.routeId}
                      colorMode={colorMode}
                      onSelect={() => setSelectedRoute(selectedRoute === r.routeId ? null : r.routeId)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Export panel */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground" />Export
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              <p className="text-[10px] text-muted-foreground mb-2">
                All formats use <strong>WGS84 (EPSG:4326)</strong> with full GIS attributes incl. FUNC_CLASS, DATA_QUALITY, BEARING, PING_DENSITY.
              </p>
              {([
                ["geojson", "GeoJSON (RFC 7946)", Globe,      "text-blue-600",  "QGIS · Mapbox · PostGIS"],
                ["kml",     "KML (OGC 2.2)",      Layers,     "text-green-600", "Google Earth · ArcGIS"],
                ["gpx",     "GPX 1.1",            Navigation, "text-amber-600", "GPS devices · QGIS · OsmAnd"],
                ["csv",     "CSV (UTF-8 + BOM)",  Table2,     "text-violet-600","Excel · R · Python"],
              ] as [string, string, any, string, string][]).map(([fmt, label, Icon, cls, compat]) => (
                <Button
                  key={fmt}
                  size="sm" variant="outline"
                  className="w-full h-8 justify-start gap-2 text-xs"
                  onClick={() => doExport(fmt as any)}
                  disabled={!!exporting || routeList.length === 0}
                >
                  {exporting === fmt ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Icon className={`h-3.5 w-3.5 ${cls}`} />}
                  <span className="flex-1 text-left">{label}</span>
                  <span className="text-[9px] text-muted-foreground">{compat}</span>
                </Button>
              ))}
              {routeList.length === 0 && !isLoading && (
                <p className="text-[10px] text-muted-foreground italic">Apply filters to load routes first.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: map + bottom panel */}
        <div className="lg:col-span-3 space-y-4">
          {/* Map */}
          <Card className="overflow-hidden">
            <div className="h-[520px] w-full">
              {isLoading
                ? <Skeleton className="h-full w-full rounded-none" />
                : <RouteMap routes={routeList} selectedId={selectedRoute} onSelect={setSelectedRoute} baseLayer={baseLayer} colorMode={colorMode} />
              }
            </div>

            {/* Map footer: legend + CRS tag */}
            <div className="px-4 py-2.5 border-t bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px]">
              {colorMode === "vehicle" && (
                <>
                  <span className="font-semibold text-muted-foreground">Vehicles:</span>
                  {routeList.slice(0, 6).map(r => (
                    <span key={r.routeId} className="flex items-center gap-1">
                      <span className="w-5 h-1.5 rounded inline-block" style={{ background: r.color }} />
                      {r.plateNumber}
                    </span>
                  ))}
                  {routeList.length > 6 && <span className="text-muted-foreground">+{routeList.length - 6} more</span>}
                </>
              )}
              {colorMode === "speed" && (
                <>
                  <span className="font-semibold text-muted-foreground">Speed scale:</span>
                  {SPEED_SCALE.map(s => (
                    <span key={s.label} className="flex items-center gap-1">
                      <span className="w-4 h-1.5 rounded inline-block" style={{ background: s.color }} />
                      {s.sublabel}
                    </span>
                  ))}
                </>
              )}
              {colorMode === "quality" && (
                <>
                  <span className="font-semibold text-muted-foreground">Quality:</span>
                  {QUALITY_SCALE.map(q => (
                    <span key={q.label} className="flex items-center gap-1">
                      <span className="w-4 h-1.5 rounded inline-block" style={{ background: q.color }} />
                      {q.label}
                    </span>
                  ))}
                </>
              )}
              <span className="ml-auto font-mono text-muted-foreground">WGS84 / EPSG:4326</span>
            </div>
          </Card>

          {/* Selected route detail */}
          {selectedData && (
            <Card className="border-blue-200 dark:border-blue-800">
              <CardHeader className="pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: getRouteColor(selectedData, colorMode) }} />
                  <CardTitle className="text-sm font-semibold flex-1">
                    {selectedData.plateNumber}
                    {selectedData.manifestCode && <span className="font-mono text-xs text-muted-foreground font-normal ml-2">{selectedData.manifestCode}</span>}
                  </CardTitle>
                  <QBadge q={selectedData.dataQuality} />
                  <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedRoute(null)}>✕</button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: "Route length",  value: `${selectedData.distanceKm} km`,       icon: Ruler },
                    { label: "Duration",      value: fmtDur(selectedData.durationMinutes),   icon: Clock },
                    { label: "Avg speed",     value: `${selectedData.avgSpeedKmh ?? "—"} km/h`, icon: Gauge },
                    { label: "Max speed",     value: `${selectedData.maxSpeedKmh ?? "—"} km/h`, icon: Gauge },
                    { label: "Speed variance",value: selectedData.speedVarianceKmh != null ? `±${selectedData.speedVarianceKmh} km/h` : "—", icon: Gauge },
                    { label: "Bearing",       value: `${selectedData.dominantBearing ?? "—"}° ${selectedData.cardinalDir ?? ""}`, icon: Navigation },
                    { label: "Ping density",  value: `${selectedData.pingDensityPerKm} /km`, icon: Navigation },
                    { label: "Data gaps",     value: `${selectedData.gapCount}`,             icon: Info },
                  ].map(s => (
                    <div key={s.label} className="space-y-0.5 bg-muted/30 rounded-lg p-2.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <s.icon className="h-2.5 w-2.5" />{s.label}
                      </p>
                      <p className="text-sm font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                  {[
                    ["FUNC_CLASS",  selectedData.funcClassInferred],
                    ["DISTRICT",    selectedData.districtName ?? "—"],
                    ["CAMPAIGN",    selectedData.campaignName ?? "—"],
                    ["DRIVER",      selectedData.driverName ?? "—"],
                    ["START_TIME",  new Date(selectedData.startTime).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
                    ["END_TIME",    new Date(selectedData.endTime).toLocaleString("en-GB",   { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
                    ["PING_COUNT",  String(selectedData.pingCount)],
                    ["COORD_SYS",   "WGS84 / EPSG:4326"],
                    ["METHOD",      "GPS_TRACK"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-start gap-1.5 py-0.5 border-b border-dashed border-muted last:border-0">
                      <span className="text-muted-foreground font-mono text-[10px] w-24 shrink-0">{k}</span>
                      <span className="font-medium text-xs truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bottom tab panel */}
          <Card>
            <div className="flex border-b">
              {([
                ["table",     "Route Attribute Table", Table2],
                ["analytics", "Speed Analytics",       BarChart2],
                ["reference", "GIS Reference",         Info],
              ] as [BottomTab, string, any][]).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setBottomTab(id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                    bottomTab === id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            <CardContent className="pt-4 pb-4">
              {bottomTab === "table" && (
                <div className="max-h-[400px] overflow-auto">
                  <RouteAttributeTable routes={routeList} onSelect={(id) => { setSelectedRoute(id); setBottomTab("table"); }} />
                </div>
              )}
              {bottomTab === "analytics" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <SpeedBandsChart routes={routeList} />
                  <QualityDistChart routes={routeList} />
                </div>
              )}
              {bottomTab === "reference" && <GisReferencePanel />}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
