import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  listGpsRoutes, listVehicles, buildGisExportUrl, KEYS,
} from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import {
  Map as MapIcon, Route, Download, RefreshCw, Filter,
  Truck, Navigation, Clock, Ruler, Gauge, Calendar,
  FileText, Globe, MapPin, ChevronDown, ChevronRight,
  Users, Layers, ArrowDownToLine,
} from "lucide-react";

const SL_CENTER: [number, number] = [8.5, -11.8];
const ROUTE_COLORS = [
  "#3b82f6","#ef4444","#22c55e","#f59e0b","#8b5cf6",
  "#ec4899","#06b6d4","#84cc16","#f97316","#a855f7",
];

function formatDur(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── FitBounds ────────────────────────────────────────────────────────────────

function FitBoundsToRoutes({ routes }: { routes: any[] }) {
  const map = useMap();
  const key = routes.map(r => r.routeId).join(",");
  useEffect(() => {
    const pts: [number, number][] = [];
    for (const r of routes) {
      if (r.coordinates?.length) {
        for (const [lng, lat] of r.coordinates) pts.push([lat, lng]);
      }
    }
    if (pts.length >= 2) {
      try {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 13 });
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

// ── RouteMap ─────────────────────────────────────────────────────────────────

function RouteMap({ routes, selectedId, onSelect }: {
  routes: any[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <MapContainer
      center={SL_CENTER}
      zoom={7}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBoundsToRoutes routes={routes} />
      {routes.map(r => {
        const pts: [number, number][] = (r.coordinates ?? []).map(([lng, lat]: [number, number]) => [lat, lng]);
        if (pts.length < 2) return null;
        const isSelected = selectedId === r.routeId;
        return (
          <Polyline
            key={r.routeId}
            positions={pts}
            pathOptions={{
              color:   r.color ?? "#3b82f6",
              weight:  isSelected ? 6 : 3,
              opacity: isSelected ? 1 : 0.72,
              dashArray: isSelected ? undefined : undefined,
            }}
            eventHandlers={{
              click: () => onSelect(isSelected ? null : r.routeId),
            }}
          >
            <Popup>
              <div className="min-w-[200px] space-y-1 py-0.5 text-sm">
                <p className="font-bold text-base">{r.plateNumber}</p>
                {r.driverName  && <p className="text-xs text-gray-500">{r.driverName}</p>}
                {r.manifestCode && <p className="text-xs font-mono text-gray-600">📋 {r.manifestCode}</p>}
                {r.districtName && <p className="text-xs text-gray-600">📍 {r.districtName} District</p>}
                {r.campaignName && <p className="text-xs text-gray-600">🌾 {r.campaignName}</p>}
                <div className="pt-1 border-t grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  <span>📅 {formatDate(r.startTime)}</span>
                  <span>⏱ {formatDur(r.durationMinutes)}</span>
                  <span>📏 {r.distanceKm} km</span>
                  {r.avgSpeedKmh && <span>💨 {r.avgSpeedKmh} km/h</span>}
                  <span>📡 {r.pingCount} pings</span>
                </div>
              </div>
            </Popup>
          </Polyline>
        );
      })}
    </MapContainer>
  );
}

// ── RouteListItem ─────────────────────────────────────────────────────────────

function RouteListItem({ r, isSelected, onSelect }: { r: any; isSelected: boolean; onSelect: () => void }) {
  return (
    <div
      className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer border transition-all ${
        isSelected
          ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20"
          : "border-transparent hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <div
        className="shrink-0 w-3 h-3 rounded-sm mt-1"
        style={{ background: r.color ?? "#3b82f6" }}
      />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-xs">{r.plateNumber}</span>
          {r.districtName && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">{r.districtName}</Badge>
          )}
        </div>
        {r.driverName && (
          <p className="text-[10px] text-muted-foreground truncate">{r.driverName}</p>
        )}
        {r.manifestCode && (
          <p className="font-mono text-[10px] text-muted-foreground/70">{r.manifestCode}</p>
        )}
        <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground pt-0.5 flex-wrap">
          <span className="flex items-center gap-0.5">
            <Calendar className="h-2.5 w-2.5" />
            {formatDate(r.startTime)}
          </span>
          <span className="flex items-center gap-0.5">
            <Ruler className="h-2.5 w-2.5" />
            {r.distanceKm} km
          </span>
          <span className="flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {formatDur(r.durationMinutes)}
          </span>
          {r.avgSpeedKmh && (
            <span className="flex items-center gap-0.5">
              <Gauge className="h-2.5 w-2.5" />
              {r.avgSpeedKmh} km/h
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Download helper ───────────────────────────────────────────────────────────

async function triggerExportDownload(
  format: "geojson" | "kml" | "gpx",
  params: { vehicleId?: number; from?: string; to?: string },
  toast: ReturnType<typeof useToast>["toast"]
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

  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  const cd = resp.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename="([^"]+)"/);
  const ext = { geojson: ".geojson", kml: ".kml", gpx: ".gpx" }[format];
  a.download = match?.[1] ?? `invendis_routes${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RoadMapping() {
  const { toast } = useToast();

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const defaultFrom = () => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  };

  const [fromDate, setFromDate]       = useState(defaultFrom);
  const [toDate, setToDate]           = useState(todayStr);
  const [vehicleFilter, setVehicleFilter] = useState<number | "">("");
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [exporting, setExporting]     = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

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

  const routeList: any[] = Array.isArray(routes) ? routes : [];
  const vehicleList: any[] = (vehiclesResp as any)?.data ?? [];

  const totalKm       = useMemo(() => routeList.reduce((s, r) => s + (r.distanceKm ?? 0), 0), [routeList]);
  const totalRoutes   = routeList.length;
  const uniqueVehicles = useMemo(() => new Set(routeList.map(r => r.vehicleId)).size, [routeList]);
  const uniqueDistricts = useMemo(() => new Set(routeList.map(r => r.districtName).filter(Boolean)).size, [routeList]);
  const totalPings    = useMemo(() => routeList.reduce((s, r) => s + (r.pingCount ?? 0), 0), [routeList]);

  const selectedData = routeList.find(r => r.routeId === selectedRoute);

  async function doExport(format: "geojson" | "kml" | "gpx") {
    setExporting(format);
    try {
      await triggerExportDownload(format, queryParams as any, toast);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="GIS Road Mapping"
        subtitle="Professional vehicle route mapping for GIS analysis and reporting. WGS84 / EPSG:4326."
        badge={
          totalRoutes > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
              <Route className="h-3 w-3" />
              {totalRoutes} routes
            </span>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Routes",      value: totalRoutes,             cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-900/20",    icon: Route },
          { label: "Distance",    value: `${Math.round(totalKm * 10) / 10} km`, cls: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-900/20", icon: Ruler },
          { label: "Vehicles",    value: uniqueVehicles,          cls: "text-violet-700",  bg: "bg-violet-50 dark:bg-violet-900/20", icon: Truck },
          { label: "Districts",   value: uniqueDistricts,         cls: "text-teal-700",    bg: "bg-teal-50 dark:bg-teal-900/20",   icon: MapPin },
          { label: "GPS Pings",   value: totalPings.toLocaleString(), cls: "text-amber-700",  bg: "bg-amber-50 dark:bg-amber-900/20", icon: Navigation },
        ].map(s => (
          <Card key={s.label} className={`${s.bg} border-transparent`}>
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg.replace("50", "100").replace("900/20", "900/40")}`}>
                <s.icon className={`h-4 w-4 ${s.cls}`} />
              </div>
              <div>
                <p className={`text-lg font-bold leading-none ${s.cls}`}>{isLoading ? "—" : s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Left panel: filters + route list ── */}
        <div className="lg:col-span-1 space-y-3">
          {/* Filter card */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <button
                className="flex items-center gap-2 w-full text-left"
                onClick={() => setShowFilters(s => !s)}
              >
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Filters</CardTitle>
                {showFilters
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                }
              </button>
            </CardHeader>
            {showFilters && (
              <CardContent className="pt-0 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">From date</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={e => setFromDate(e.target.value)}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">To date</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={e => setToDate(e.target.value)}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vehicle</label>
                  <select
                    value={String(vehicleFilter)}
                    onChange={e => setVehicleFilter(e.target.value ? Number(e.target.value) : "")}
                    className="w-full text-xs h-8 px-2.5 rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">All vehicles</option>
                    {vehicleList.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.plateNumber ?? v.plate_number ?? `#${v.id}`}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => refetch()}>
                    Apply
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setFromDate(defaultFrom()); setToDate(todayStr()); setVehicleFilter(""); }}
                  >
                    Reset
                  </Button>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Export card */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowDownToLine className="h-3.5 w-3.5 text-muted-foreground" />
                Export / Download
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <p className="text-[10px] text-muted-foreground">
                All exports are in <strong>WGS84 (EPSG:4326)</strong> — compatible with QGIS, ArcGIS, Google Earth, and all GIS platforms.
              </p>
              <div className="space-y-1.5">
                <Button
                  size="sm" variant="outline" className="w-full h-8 justify-start gap-2 text-xs"
                  onClick={() => doExport("geojson")}
                  disabled={!!exporting || routeList.length === 0}
                >
                  {exporting === "geojson"
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Globe className="h-3.5 w-3.5 text-blue-600" />
                  }
                  GeoJSON (RFC 7946)
                  <span className="ml-auto text-muted-foreground">QGIS / Web</span>
                </Button>
                <Button
                  size="sm" variant="outline" className="w-full h-8 justify-start gap-2 text-xs"
                  onClick={() => doExport("kml")}
                  disabled={!!exporting || routeList.length === 0}
                >
                  {exporting === "kml"
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Layers className="h-3.5 w-3.5 text-green-600" />
                  }
                  KML (OGC 2.2)
                  <span className="ml-auto text-muted-foreground">Google Earth / ArcGIS</span>
                </Button>
                <Button
                  size="sm" variant="outline" className="w-full h-8 justify-start gap-2 text-xs"
                  onClick={() => doExport("gpx")}
                  disabled={!!exporting || routeList.length === 0}
                >
                  {exporting === "gpx"
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Navigation className="h-3.5 w-3.5 text-amber-600" />
                  }
                  GPX 1.1
                  <span className="ml-auto text-muted-foreground">GPS devices / QGIS</span>
                </Button>
              </div>
              {routeList.length === 0 && !isLoading && (
                <p className="text-[10px] text-muted-foreground italic">No routes in current filter — adjust dates or vehicle filter.</p>
              )}
            </CardContent>
          </Card>

          {/* Route list */}
          <Card>
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Route className="h-3.5 w-3.5 text-muted-foreground" />
                Routes
                {!isLoading && (
                  <span className="ml-auto text-xs text-muted-foreground font-normal">{routeList.length} found</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : error ? (
                <p className="text-xs text-destructive py-3">{(error as any).message}</p>
              ) : routeList.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
                  <MapIcon className="h-8 w-8 opacity-20" />
                  <p className="text-sm">No routes in this date range</p>
                  <p className="text-xs text-center">GPS pings are recorded when vehicles are tracked. Adjust the filters above.</p>
                </div>
              ) : (
                <div className="space-y-0.5 max-h-[480px] overflow-y-auto -mx-1 px-1">
                  {routeList.map(r => (
                    <RouteListItem
                      key={r.routeId}
                      r={r}
                      isSelected={selectedRoute === r.routeId}
                      onSelect={() => setSelectedRoute(selectedRoute === r.routeId ? null : r.routeId)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right panel: map + selected route detail ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Map */}
          <Card className="overflow-hidden">
            <div className="h-[560px] w-full">
              {isLoading ? (
                <Skeleton className="h-full w-full rounded-none" />
              ) : (
                <RouteMap
                  routes={routeList}
                  selectedId={selectedRoute}
                  onSelect={setSelectedRoute}
                />
              )}
            </div>
            {/* Legend */}
            <div className="px-4 py-2 border-t bg-muted/30 flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground/70">Legend:</span>
              {routeList.slice(0, 8).map(r => (
                <span key={r.routeId} className="flex items-center gap-1">
                  <span className="w-5 h-1.5 rounded inline-block" style={{ background: r.color }} />
                  {r.plateNumber}
                </span>
              ))}
              {routeList.length > 8 && <span>+{routeList.length - 8} more</span>}
              {routeList.length === 0 && (
                <span>No routes to display — GPS tracks appear here once vehicles are tracked.</span>
              )}
              <span className="ml-auto">CRS: WGS84 / EPSG:4326</span>
            </div>
          </Card>

          {/* Selected route detail */}
          {selectedData && (
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ background: selectedData.color }}
                  />
                  {selectedData.plateNumber}
                  {selectedData.manifestCode && (
                    <span className="font-mono text-xs text-muted-foreground font-normal ml-1">{selectedData.manifestCode}</span>
                  )}
                  <button
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedRoute(null)}
                  >✕</button>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                  {[
                    { label: "Distance",  value: `${selectedData.distanceKm} km`,  icon: Ruler },
                    { label: "Duration",  value: formatDur(selectedData.durationMinutes), icon: Clock },
                    { label: "Avg Speed", value: selectedData.avgSpeedKmh ? `${selectedData.avgSpeedKmh} km/h` : "—", icon: Gauge },
                    { label: "GPS Pings", value: String(selectedData.pingCount),   icon: Navigation },
                  ].map(s => (
                    <div key={s.label} className="space-y-1 bg-muted/30 rounded-lg p-2.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                        <s.icon className="h-2.5 w-2.5" />{s.label}
                      </p>
                      <p className="text-sm font-bold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  {[
                    ["Vehicle",   selectedData.plateNumber],
                    ["Driver",    selectedData.driverName ?? "—"],
                    ["Manifest",  selectedData.manifestCode ?? "—"],
                    ["Campaign",  selectedData.campaignName ?? "—"],
                    ["District",  selectedData.districtName ?? "—"],
                    ["Start",     new Date(selectedData.startTime).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
                    ["End",       new Date(selectedData.endTime).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
                    ["Coord Sys", "WGS84 / EPSG:4326"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-start gap-1.5 py-0.5">
                      <span className="text-muted-foreground shrink-0 w-20">{k}:</span>
                      <span className="font-medium truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* GIS standards info */}
          <Card className="bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-semibold">GIS Export Specification</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground/80 mb-0.5">GeoJSON (RFC 7946)</p>
                      <p>FeatureCollection · LineString geometry · CRS: WGS84 · Full metadata properties · Compatible with QGIS, Mapbox, Leaflet, PostGIS</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/80 mb-0.5">KML (OGC 2.2)</p>
                      <p>Color-coded vehicle styles · TimeSpan per route · ExtendedData attributes · tessellate:1 · Compatible with Google Earth Pro, ArcGIS</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/80 mb-0.5">GPX 1.1</p>
                      <p>Track segments · Speed per point (m/s) · Bounding box · ISO 8601 timestamps · Compatible with GPS devices, QGIS, OsmAnd</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
