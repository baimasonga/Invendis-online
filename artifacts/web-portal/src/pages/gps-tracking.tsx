import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  listVehicleGpsStatus, listGpsTrack, listGpsVehicleHistory, KEYS,
  listGpsTraceUnits, listGpsTraceStatus, listGpsTraceLive,
  linkGpsTraceUnit, unlinkGpsTraceUnit, triggerGpsTraceSync,
} from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, MapPin, Radio, Clock, Gauge, Navigation,
  ChevronRight, RefreshCw, Wifi, WifiOff, Target,
  AlertTriangle, CheckCircle2, RouteOff, Link2, Link2Off,
  Signal, Settings2, ArrowRight, Warehouse, History, Timer,
} from "lucide-react";

// ── Nominatim reverse-geocoding ───────────────────────────────────────────────

const _geoCache = new Map<string, string>();
const _geoQueue: Array<{ key: string; lat: number; lng: number; resolve: (v: string) => void }> = [];
let _geoTimer: ReturnType<typeof setTimeout> | null = null;

function _geoKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function _processGeoQueue(): void {
  if (_geoTimer || !_geoQueue.length) return;
  _geoTimer = setTimeout(async () => {
    _geoTimer = null;
    const item = _geoQueue.shift();
    if (!item) return;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${item.lat}&lon=${item.lng}&format=json`,
        { headers: { "Accept-Language": "en", "User-Agent": "InvendisApp/1.0" } }
      );
      const d = await r.json();
      const a = d.address ?? {};
      const parts = [
        a.road ?? a.pedestrian ?? a.footway,
        a.suburb ?? a.neighbourhood ?? a.quarter,
        a.town ?? a.city ?? a.village ?? a.county,
      ].filter(Boolean);
      const label = parts.join(", ") || (d.display_name ?? "").split(",").slice(0, 3).join(",").trim() || item.key;
      _geoCache.set(item.key, label);
      item.resolve(label);
    } catch {
      const fallback = `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`;
      _geoCache.set(item.key, fallback);
      item.resolve(fallback);
    }
    if (_geoQueue.length) _processGeoQueue();
  }, 1150);
}

function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = _geoKey(lat, lng);
  if (_geoCache.has(key)) return Promise.resolve(_geoCache.get(key)!);
  return new Promise(resolve => {
    _geoQueue.push({ key, lat, lng, resolve });
    _processGeoQueue();
  });
}

function useReverseGeocode(lat?: number | null, lng?: number | null): string | null {
  const [loc, setLoc] = useState<string | null>(null);
  useEffect(() => {
    if (lat == null || lng == null) return;
    const key = _geoKey(lat, lng);
    if (_geoCache.has(key)) { setLoc(_geoCache.get(key)!); return; }
    let cancelled = false;
    reverseGeocode(lat, lng).then(v => { if (!cancelled) setLoc(v); });
    return () => { cancelled = true; };
  }, [lat, lng]);
  return loc;
}

// ── VehicleCard ───────────────────────────────────────────────────────────────

function VehicleCard({ v, isSelected, onSelect }: { v: any; isSelected: boolean; onSelect: () => void }) {
  const tier = getSignalTier(v.lastPing);
  const currentLoc = useReverseGeocode(v.lastLatitude, v.lastLongitude);
  const noDestination = !v.hasDestination && !v.destinationLabel;

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-emerald-500 shadow-md" : "hover:border-emerald-200"}`}
      onClick={onSelect}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Truck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              {tier === "live" && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight">{v.plateNumber ?? "Unknown"}</p>
              <p className="text-xs text-muted-foreground truncate">{v.vehicleType ?? "Vehicle"}{v.driverName ? ` · ${v.driverName}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <SignalBadge lastPing={v.lastPing} />
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`} />
          </div>
        </div>

        {/* Current location */}
        <div className="pt-2 border-t">
          <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
            <MapPin className="h-2.5 w-2.5" /> Current location · <span className="tabular-nums">{formatAgo(v.lastPing)}</span>
          </p>
          {currentLoc ? (
            <p className="text-xs font-medium leading-tight">{currentLoc}</p>
          ) : v.lastLatitude != null ? (
            <p className="text-xs text-muted-foreground animate-pulse">Locating…</p>
          ) : (
            <p className="text-xs text-muted-foreground">No position</p>
          )}
        </div>

        {/* Journey: FROM → TO */}
        <div className="pt-2 border-t space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
            <Warehouse className="h-2.5 w-2.5 shrink-0 text-blue-500" />
            <span className="truncate font-medium text-blue-700 dark:text-blue-400">
              {v.warehouseName ?? "Origin unknown"}
            </span>
            <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
            {v.destinationLabel ? (
              <span className="truncate font-medium text-teal-700 dark:text-teal-400 flex items-center gap-1">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                {v.destinationLabel}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> No destination
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <ArrivalBadge vehicle={v} />
            {v.distanceLabel && (
              <p className="text-xs text-muted-foreground tabular-nums">{v.distanceLabel} away</p>
            )}
          </div>
          {noDestination && (
            <div className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight">
                Destination unknown! Set a distribution site on the campaign.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── GpsHistoryRow ─────────────────────────────────────────────────────────────

function GpsHistoryRow({ pt, isFirst }: { pt: any; isFirst: boolean }) {
  const loc = useReverseGeocode(pt.latitude, pt.longitude);
  return (
    <div className="flex items-start gap-3 py-2 px-1 group">
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${isFirst ? "bg-emerald-500" : "bg-slate-200"}`} />
      <div className="flex-1 min-w-0">
        {loc ? (
          <p className="text-xs font-medium leading-tight truncate">{loc}</p>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            {pt.latitude?.toFixed(5)}, {pt.longitude?.toFixed(5)}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {pt.speed != null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Gauge className="h-2.5 w-2.5" />{pt.speed} km/h
            </span>
          )}
          {pt.heading != null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Navigation className="h-2.5 w-2.5" />{pt.heading}°
            </span>
          )}
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {pt.latitude?.toFixed(5)}, {pt.longitude?.toFixed(5)}
          </span>
        </div>
      </div>
      <span className="ml-auto text-[10px] text-muted-foreground shrink-0 pt-0.5">
        {new Date(pt.recordedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
      </span>
    </div>
  );
}

// ── Duration helpers ──────────────────────────────────────────────────────────

function formatDuration(mins: number): string {
  if (mins < 1)  return "< 1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function useLiveDuration(departedAt: string | null | undefined): number | null {
  const [mins, setMins] = useState<number | null>(null);
  useEffect(() => {
    if (!departedAt) { setMins(null); return; }
    const update = () => setMins(Math.round((Date.now() - new Date(departedAt).getTime()) / 60000));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [departedAt]);
  return mins;
}

// Sierra Leone default center
const SL_CENTER: [number, number] = [8.5, -11.5];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "No signal";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getSignalTier(lastPing: string | null | undefined): "live" | "recent" | "stale" | "offline" {
  if (!lastPing) return "offline";
  const mins = (Date.now() - new Date(lastPing).getTime()) / 60000;
  if (mins < 5)  return "live";
  if (mins < 30) return "recent";
  return "stale";
}

const SIGNAL_CONFIG = {
  live:    { dot: "bg-emerald-500", label: "Live",    labelCls: "bg-emerald-100 text-emerald-700", icon: Wifi,    iconCls: "text-emerald-500" },
  recent:  { dot: "bg-amber-400",   label: "Recent",  labelCls: "bg-amber-100   text-amber-700",   icon: Wifi,    iconCls: "text-amber-500"   },
  stale:   { dot: "bg-orange-400",  label: "Stale",   labelCls: "bg-orange-100  text-orange-700",  icon: WifiOff, iconCls: "text-orange-400"  },
  offline: { dot: "bg-slate-300",   label: "Offline", labelCls: "bg-slate-100   text-slate-500",   icon: WifiOff, iconCls: "text-slate-400"   },
};

function SignalBadge({ lastPing }: { lastPing: string | null | undefined }) {
  const tier = getSignalTier(lastPing);
  const c = SIGNAL_CONFIG[tier];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${c.labelCls}`}>
      <Icon className={`h-2.5 w-2.5 ${c.iconCls}`} />
      {c.label}
    </span>
  );
}

type ArrivalStatus = "arrived" | "en_route" | "not_reached" | "no_destination" | "no_signal";

function getArrivalStatus(v: any): ArrivalStatus {
  if (v.arrivedAt || v.withinGeofence === true) return "arrived";
  if (!v.hasDestination) return "no_destination";
  if (v.lastLatitude == null) return "no_signal";
  const tier = getSignalTier(v.lastPing);
  if (tier === "offline" && !v.arrivedAt) return "not_reached";
  return "en_route";
}

const ARRIVAL_CONFIG: Record<ArrivalStatus, { label: string; cls: string; icon: any }> = {
  arrived:        { label: "Arrived",       cls: "bg-teal-100    text-teal-700",   icon: CheckCircle2 },
  en_route:       { label: "En Route",      cls: "bg-blue-100    text-blue-700",   icon: Navigation   },
  not_reached:    { label: "Not Reached",   cls: "bg-red-100     text-red-700",    icon: AlertTriangle },
  no_destination: { label: "No Destination",cls: "bg-amber-100   text-amber-700",  icon: Target       },
  no_signal:      { label: "No Signal",     cls: "bg-slate-100   text-slate-500",  icon: RouteOff     },
};

function ArrivalBadge({ vehicle }: { vehicle: any }) {
  const status = getArrivalStatus(vehicle);
  const c = ARRIVAL_CONFIG[status];
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${c.cls}`}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {c.label}
    </span>
  );
}

function CoordDisplay({ lat, lng }: { lat: number | null | undefined; lng: number | null | undefined }) {
  if (lat == null || lng == null) return <span className="text-xs text-muted-foreground">No position</span>;
  return (
    <span className="font-mono text-xs tabular-nums">
      {lat.toFixed(5)}, {lng.toFixed(5)}
    </span>
  );
}

// ── Leaflet map icons ──────────────────────────────────────────────────────────

const TIER_HEX: Record<string, string> = {
  live: "#10b981", recent: "#f59e0b", stale: "#f97316", offline: "#94a3b8",
};

function createVehicleIcon(tier: "live" | "recent" | "stale" | "offline", selected: boolean): L.DivIcon {
  const color = TIER_HEX[tier];
  const s = selected ? 44 : 36;
  const shadow = selected
    ? `filter:drop-shadow(0 0 6px ${color});`
    : "filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));";
  const truckW = selected ? 18 : 14;
  return L.divIcon({
    className: "leaflet-vehicle-marker",
    html: `<div style="
        position:relative;
        width:${s}px;height:${s}px;
        background:${color};
        border:3px solid white;
        border-radius:50%;
        ${shadow}
        display:flex;align-items:center;justify-content:center;
      ">
      <svg xmlns='http://www.w3.org/2000/svg' width='${truckW}' height='${truckW}' viewBox='0 0 24 24' fill='white'>
        <path d='M1 3h15v13H1zM16 8h4l3 3v5h-7V8z'/><circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/>
      </svg>
    </div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    popupAnchor: [0, -s / 2 - 8],
  });
}

function createDestIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:30px;height:30px;background:#14b8a6;border:2.5px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;">
      <svg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 24 24' fill='white' style='transform:rotate(45deg)'>
        <path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z'/>
      </svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [0, 30],
    popupAnchor: [15, -30],
  });
}

function createTrackerIcon(tier: "live" | "recent" | "stale" | "offline", selected: boolean): L.DivIcon {
  const color = TIER_HEX[tier];
  const s = selected ? 38 : 30;
  const shadow = selected ? `filter:drop-shadow(0 0 5px ${color});` : "filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));";
  return L.divIcon({
    className: "leaflet-tracker-marker",
    html: `<div style="
        position:relative;width:${s}px;height:${s}px;
        background:${color};border:2.5px solid white;
        border-radius:4px;${shadow}
        display:flex;align-items:center;justify-content:center;">
      <svg xmlns='http://www.w3.org/2000/svg' width='${Math.round(s * 0.45)}' height='${Math.round(s * 0.45)}' viewBox='0 0 24 24' fill='white'>
        <path d='M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z'/>
      </svg>
    </div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    popupAnchor: [0, -s / 2 - 6],
  });
}

// ── FitBoundsOnChange ─────────────────────────────────────────────────────────

function FitBoundsOnChange({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map(p => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13, { animate: true });
      return;
    }
    try {
      map.fitBounds(points as L.LatLngTuple[], { padding: [50, 50], maxZoom: 14, animate: true });
    } catch {}
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// ── VehicleMap ────────────────────────────────────────────────────────────────

interface VehicleMapProps {
  vehicles: any[];
  selectedVehicle: number | null;
  trackPoints: any[];
  selectedData: any;
  onSelect: (id: number | null) => void;
}

function VehicleMap({ vehicles, selectedVehicle, trackPoints, selectedData, onSelect }: VehicleMapProps) {
  const fitPoints = useMemo<[number, number][]>(() => {
    if (selectedVehicle) {
      const pts: [number, number][] = trackPoints
        .filter(p => p.latitude != null && p.longitude != null)
        .map(p => [p.latitude, p.longitude]);
      if (selectedData?.effectiveDestLat != null && selectedData?.effectiveDestLng != null) {
        pts.push([selectedData.effectiveDestLat, selectedData.effectiveDestLng]);
      }
      if (pts.length === 0 && selectedData?.lastLatitude != null) {
        pts.push([selectedData.lastLatitude, selectedData.lastLongitude]);
      }
      return pts;
    }
    return vehicles
      .filter(v => v.lastLatitude != null && v.lastLongitude != null)
      .map(v => [v.lastLatitude, v.lastLongitude]);
  }, [selectedVehicle, trackPoints, selectedData, vehicles]);

  const trackLine = useMemo<[number, number][]>(
    () => trackPoints
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => [p.latitude, p.longitude]),
    [trackPoints]
  );

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
      <FitBoundsOnChange points={fitPoints} />

      {/* All vehicle markers */}
      {vehicles
        .filter(v => v.lastLatitude != null && v.lastLongitude != null)
        .map(v => {
          const tier = getSignalTier(v.lastPing);
          return (
            <Marker
              key={v.id}
              position={[v.lastLatitude, v.lastLongitude]}
              icon={createVehicleIcon(tier, selectedVehicle === v.id)}
              eventHandlers={{ click: () => onSelect(selectedVehicle === v.id ? null : v.id) }}
            >
              <Popup>
                <div className="min-w-[160px] py-0.5">
                  <p className="font-semibold text-sm">{v.plateNumber}</p>
                  <p className="text-xs text-gray-500">{v.vehicleType ?? "Vehicle"}{v.driverName ? ` · ${v.driverName}` : ""}</p>
                  <p className="text-xs mt-1">{formatAgo(v.lastPing)}</p>
                  {v.destinationLabel && (
                    <p className="text-xs text-gray-500 mt-0.5">→ {v.destinationLabel}</p>
                  )}
                  {v.distanceLabel && (
                    <p className="text-xs font-medium text-blue-600 mt-0.5">{v.distanceLabel} away</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

      {/* GPS track polyline for selected vehicle */}
      {trackLine.length > 1 && (
        <Polyline
          positions={trackLine}
          color="#3b82f6"
          weight={3}
          opacity={0.7}
        />
      )}

      {/* Destination marker + geofence circle */}
      {selectedData?.effectiveDestLat != null && selectedData?.effectiveDestLng != null && (
        <>
          <Marker
            position={[selectedData.effectiveDestLat, selectedData.effectiveDestLng]}
            icon={createDestIcon()}
          >
            <Popup>
              <p className="font-semibold text-sm">{selectedData.destinationLabel ?? "Destination"}</p>
              {selectedData.distanceLabel && (
                <p className="text-xs mt-0.5">{selectedData.distanceLabel} from vehicle</p>
              )}
            </Popup>
          </Marker>
          <Circle
            center={[selectedData.effectiveDestLat, selectedData.effectiveDestLng]}
            radius={selectedData.geofenceRadius ?? 500}
            color="#14b8a6"
            fillColor="#14b8a6"
            fillOpacity={0.12}
            weight={1.5}
          />
        </>
      )}
    </MapContainer>
  );
}

// ── TrackerCard ───────────────────────────────────────────────────────────────

function TrackerCard({ t, isSelected, onSelect }: { t: any; isSelected: boolean; onSelect: () => void }) {
  const tier = getSignalTier(t.recordedAt);
  const c = SIGNAL_CONFIG[tier];
  const Icon = c.icon;
  const hasPos = t.lat != null && t.lng != null;

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-blue-500 shadow-md" : "hover:border-blue-200"}`}
      onClick={onSelect}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Radio className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
              </div>
              {tier === "live" && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-xs leading-tight truncate">{t.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono truncate">{t.ident ?? "—"}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${c.labelCls}`}>
            <Icon className={`h-2.5 w-2.5 ${c.iconCls}`} />
            {c.label}
          </span>
        </div>

        <div className="border-t pt-2 flex items-center justify-between gap-2 flex-wrap">
          {hasPos ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {t.lat.toFixed(4)}, {t.lng.toFixed(4)}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">No position</span>
          )}
          <div className="flex items-center gap-2">
            {t.speed != null && t.speed > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Gauge className="h-2.5 w-2.5" />{t.speed} km/h
              </span>
            )}
            {t.recordedAt && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{formatAgo(t.recordedAt)}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── TrackerMap ────────────────────────────────────────────────────────────────

function TrackerMap({ trackers, selectedId, onSelect }: { trackers: any[]; selectedId: number | null; onSelect: (id: number | null) => void }) {
  const positioned = trackers.filter(t => t.lat != null && t.lng != null);

  const fitPoints = useMemo<[number, number][]>(
    () => positioned.map(t => [t.lat, t.lng]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positioned.map(t => `${t.id}`).join(",")]
  );

  return (
    <MapContainer center={SL_CENTER} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBoundsOnChange points={fitPoints} />
      {positioned.map(t => {
        const tier = getSignalTier(t.recordedAt);
        return (
          <Marker
            key={t.id}
            position={[t.lat, t.lng]}
            icon={createTrackerIcon(tier, selectedId === t.id)}
            eventHandlers={{ click: () => onSelect(selectedId === t.id ? null : t.id) }}
          >
            <Popup>
              <div className="min-w-[160px] py-0.5">
                <p className="font-semibold text-sm">{t.label}</p>
                <p className="text-xs text-gray-500 font-mono">{t.ident ?? "—"}</p>
                {t.speed != null && <p className="text-xs mt-1">{t.speed} km/h</p>}
                <p className="text-xs text-gray-400 mt-0.5">{formatAgo(t.recordedAt)}</p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

// ── TripHistoryRow ────────────────────────────────────────────────────────────

function TripHistoryRow({ trip: t }: { trip: any }) {
  const elapsed = useLiveDuration(t.isOngoing ? t.departedAt : null);

  return (
    <div className="py-2.5 px-1 flex items-start gap-3">
      <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${t.isOngoing ? "bg-emerald-500" : "bg-slate-200"}`} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-1 text-xs flex-wrap">
          <span className="font-medium text-blue-700 dark:text-blue-400 flex items-center gap-0.5">
            <Warehouse className="h-2.5 w-2.5 shrink-0" />
            {t.warehouseName ?? "Unknown origin"}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium text-teal-700 dark:text-teal-400 flex items-center gap-0.5">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            {t.districtName ? `${t.districtName} District` : (t.campaignName ?? "Unknown destination")}
          </span>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {t.departedAt
              ? new Date(t.departedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
              : "Not departed"}
          </span>
          {(t.durationMins != null || elapsed != null) && (
            <span className={`text-[10px] font-medium flex items-center gap-0.5 ${t.isOngoing ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
              <Timer className="h-2.5 w-2.5" />
              {t.isOngoing
                ? `${formatDuration(elapsed ?? t.durationMins ?? 0)} elapsed`
                : formatDuration(t.durationMins ?? 0)}
            </span>
          )}
          {t.manifestCode && (
            <span className="font-mono text-[10px] text-muted-foreground/60">{t.manifestCode}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        {t.isOngoing ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Active
          </span>
        ) : t.arrivedAt ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-teal-100 text-teal-700">
            <CheckCircle2 className="h-2.5 w-2.5" /> Done
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
            {t.status ?? "Pending"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── TripHistoryPanel ──────────────────────────────────────────────────────────

function TripHistoryPanel({ vehicleId, plateNumber }: { vehicleId: number; plateNumber: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gps-history", vehicleId],
    queryFn: () => listGpsVehicleHistory(vehicleId, 15),
    refetchInterval: 60_000,
  });

  const trips: any[] = Array.isArray(data) ? data : [];

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <History className="h-3.5 w-3.5 text-violet-700 dark:text-violet-400" />
          </div>
          {plateNumber} — Dispatch History
          {isLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
            <History className="h-7 w-7 opacity-20" />
            <p className="text-sm">No dispatch history yet.</p>
          </div>
        ) : (
          <div className="divide-y max-h-[280px] overflow-y-auto">
            {trips.map((t: any, i: number) => (
              <TripHistoryRow key={t.dispatchId ?? i} trip={t} />
            ))}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-2">Showing last {trips.length} dispatches that departed.</p>
      </CardContent>
    </Card>
  );
}

// ── GPS-Trace Management Panel ────────────────────────────────────────────────

function GpsTracePanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [linking, setLinking] = useState<number | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<Record<number, string>>({});

  const { data: vehicles, isLoading: loadingVehicles } = useQuery({
    queryKey: ["gps-trace-status"],
    queryFn: listGpsTraceStatus,
  });

  const { data: units, isLoading: loadingUnits, error: unitsError } = useQuery({
    queryKey: ["gps-trace-units"],
    queryFn: listGpsTraceUnits,
    retry: 1,
  });

  const linkMut = useMutation({
    mutationFn: ({ vehicleId, unitId, unitLabel }: { vehicleId: number; unitId: string; unitLabel?: string }) =>
      linkGpsTraceUnit(vehicleId, unitId, unitLabel),
    onSuccess: (_, { vehicleId }) => {
      toast({ title: "Tracker linked", description: "GPS-Trace unit linked to vehicle." });
      setLinking(null);
      setSelectedUnit(p => { const n = { ...p }; delete n[vehicleId]; return n; });
      qc.invalidateQueries({ queryKey: ["gps-trace-status"] });
      qc.invalidateQueries({ queryKey: KEYS.vehicles() });
    },
    onError: (e: any) => toast({ title: "Link failed", description: e.message, variant: "destructive" }),
  });

  const unlinkMut = useMutation({
    mutationFn: (vehicleId: number) => unlinkGpsTraceUnit(vehicleId),
    onSuccess: () => {
      toast({ title: "Tracker unlinked" });
      qc.invalidateQueries({ queryKey: ["gps-trace-status"] });
      qc.invalidateQueries({ queryKey: KEYS.vehicles() });
    },
    onError: (e: any) => toast({ title: "Unlink failed", description: e.message, variant: "destructive" }),
  });

  const syncMut = useMutation({
    mutationFn: triggerGpsTraceSync,
    onSuccess: (r) => {
      toast({ title: "Sync complete", description: `${r.synced} synced, ${r.skipped} skipped.` });
      qc.invalidateQueries({ queryKey: KEYS.vehicles() });
      qc.invalidateQueries({ queryKey: ["gps-trace-status"] });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const vehicleList: any[] = Array.isArray(vehicles) ? vehicles : [];
  const unitList: any[] = Array.isArray(units) ? units : [];
  const linkedCount = vehicleList.filter((v: any) => v.gpsDeviceId).length;

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Signal className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">GPS-Trace Tracker Setup</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Link your GPS-Trace tracker units to vehicles for live tracking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {linkedCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {linkedCount} / {vehicleList.length} linked
              </Badge>
            )}
            <Button
              size="sm" variant="outline" className="h-8"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMut.isPending ? "animate-spin" : ""}`} />
              Sync Now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {unitsError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400 text-xs mb-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Could not connect to GPS-Trace: {(unitsError as any).message}</span>
          </div>
        )}
        {unitList.length > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-400 text-xs mb-3">
            <Signal className="h-3.5 w-3.5 shrink-0" />
            <span>{unitList.length} tracker unit{unitList.length !== 1 ? "s" : ""} found in GPS-Trace account. Link each unit to a vehicle below.</span>
          </div>
        )}
        {loadingVehicles ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : vehicleList.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No vehicles registered yet.</p>
        ) : (
          <div className="space-y-2">
            {vehicleList.map((v: any) => {
              const isLinked = !!v.gpsDeviceId;
              const isLinking = linking === v.id;
              const linkedUnit = unitList.find((u: any) => String(u.id) === String(v.gpsDeviceId));
              return (
                <div key={v.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0 border">
                    <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{v.plateNumber}</p>
                    <p className="text-xs text-muted-foreground">{v.vehicleCode}</p>
                  </div>
                  {isLinked ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <Link2 className="h-3 w-3" />
                          {linkedUnit?.label ?? `Unit #${v.gpsDeviceId}`}
                        </p>
                        {v.lastPing && (
                          <p className="text-[10px] text-muted-foreground">{formatAgo(v.lastPing)}</p>
                        )}
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                        onClick={() => unlinkMut.mutate(v.id)}
                        disabled={unlinkMut.isPending}
                        title="Unlink tracker"
                      >
                        <Link2Off className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : isLinking ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={selectedUnit[v.id] ?? ""}
                        onValueChange={(val) => setSelectedUnit(p => ({ ...p, [v.id]: val }))}
                      >
                        <SelectTrigger className="h-7 text-xs w-52">
                          <SelectValue placeholder={loadingUnits ? "Loading units…" : "Select tracker unit"} />
                        </SelectTrigger>
                        <SelectContent>
                          {unitList.map((u: any) => (
                            <SelectItem key={u.id} value={String(u.id)} className="text-xs">
                              {u.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm" className="h-7 text-xs"
                        onClick={() => {
                          const uid = selectedUnit[v.id];
                          const label = unitList.find((u: any) => String(u.id) === uid)?.label;
                          if (uid) linkMut.mutate({ vehicleId: v.id, unitId: uid, unitLabel: label });
                        }}
                        disabled={!selectedUnit[v.id] || linkMut.isPending}
                      >
                        Link
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => setLinking(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs shrink-0"
                      onClick={() => setLinking(v.id)}
                    >
                      <Link2 className="h-3 w-3 mr-1" /> Link Tracker
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground mt-3">
          Positions sync automatically every 30 seconds from your GPS-Trace account.
        </p>
      </CardContent>
    </Card>
  );
}

// ── SelectedVehiclePanel ──────────────────────────────────────────────────────

function SelectedVehiclePanel({ data: d, trackPoints }: { data: any; trackPoints: any[] }) {
  const currentLoc = useReverseGeocode(d.lastLatitude, d.lastLongitude);
  const destLoc    = useReverseGeocode(d.effectiveDestLat, d.effectiveDestLng);
  const noDestination = !d.hasDestination && !d.destinationLabel;
  const elapsed = useLiveDuration(!d.arrivedAt ? d.departedAt : null);
  const avgSpeed = useMemo(() => {
    const speeds = trackPoints.filter((p: any) => p.speed != null && p.speed > 0).map((p: any) => p.speed as number);
    if (!speeds.length) return null;
    return Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length);
  }, [trackPoints]);

  return (
    <Card className={
      getArrivalStatus(d) === "arrived"
        ? "border-teal-200 bg-teal-50/50 dark:bg-teal-900/10"
        : noDestination
        ? "border-amber-200 bg-amber-50/50 dark:bg-amber-900/10"
        : ""
    }>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {d.plateNumber} — Journey
          </p>
          <ArrivalBadge vehicle={d} />
        </div>

        {/* FROM → TO */}
        <div className="flex items-start gap-2 flex-wrap">
          {/* Origin */}
          <div className="flex-1 min-w-[120px] rounded-lg border bg-blue-50/60 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800 px-3 py-2 space-y-0.5">
            <p className="text-[10px] text-blue-500 font-medium uppercase tracking-wide flex items-center gap-1">
              <Warehouse className="h-2.5 w-2.5" /> From (Warehouse)
            </p>
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 leading-tight">
              {d.warehouseName ?? "Unknown warehouse"}
            </p>
          </div>

          <div className="flex items-center pt-4 shrink-0">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>

          {/* Destination */}
          <div className={`flex-1 min-w-[120px] rounded-lg border px-3 py-2 space-y-0.5 ${
            noDestination
              ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700"
              : "bg-teal-50/60 dark:bg-teal-900/10 border-teal-100 dark:border-teal-800"
          }`}>
            <p className={`text-[10px] font-medium uppercase tracking-wide flex items-center gap-1 ${noDestination ? "text-amber-500" : "text-teal-600"}`}>
              <MapPin className="h-2.5 w-2.5" /> To (Distribution Site)
            </p>
            {noDestination ? (
              <div className="flex items-start gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 leading-tight">No destination set</p>
                  <p className="text-[10px] text-amber-600 leading-tight">Set a distribution site on the campaign to enable navigation.</p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-teal-800 dark:text-teal-300 leading-tight">
                  {d.destinationLabel}
                </p>
                {destLoc && destLoc !== d.destinationLabel && (
                  <p className="text-[10px] text-muted-foreground">{destLoc}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Current position + links */}
        <div className="flex items-start justify-between gap-3 pt-1 flex-wrap">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <MapPin className="h-2.5 w-2.5" /> Current position · {formatAgo(d.lastPing)}
            </p>
            {currentLoc ? (
              <p className="text-xs font-medium leading-tight">{currentLoc}</p>
            ) : d.lastLatitude != null ? (
              <p className="text-xs text-muted-foreground animate-pulse">Locating…</p>
            ) : null}
            {d.lastLatitude != null && (
              <p className="font-mono text-[10px] text-muted-foreground/60">
                {d.lastLatitude.toFixed(5)}, {d.lastLongitude?.toFixed(5)}
              </p>
            )}
            {d.distanceLabel && !noDestination && (
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                {d.distanceLabel} from destination
              </p>
            )}
            {d.campaignName && (
              <p className="text-[10px] text-muted-foreground">{d.campaignName}{d.manifestCode ? ` · ${d.manifestCode}` : ""}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {d.lastLatitude != null && (
              <a href={`https://www.google.com/maps?q=${d.lastLatitude},${d.lastLongitude}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs w-full">
                  <MapPin className="h-3.5 w-3.5 mr-1" /> Open in Maps
                </Button>
              </a>
            )}
            {d.effectiveDestLat != null && d.lastLatitude != null && (
              <a href={`https://www.google.com/maps/dir/${d.lastLatitude},${d.lastLongitude}/${d.effectiveDestLat},${d.effectiveDestLng}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs w-full text-blue-600 border-blue-200 hover:bg-blue-50">
                  <Navigation className="h-3.5 w-3.5 mr-1" /> Get Directions
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Journey timing strip */}
        {(d.departedAt || d.arrivedAt || avgSpeed != null) && (
          <div className="pt-2 border-t grid grid-cols-2 sm:grid-cols-4 gap-3">
            {d.departedAt && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" /> Departed
                </p>
                <p className="text-xs font-medium tabular-nums">
                  {new Date(d.departedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            )}
            {!d.arrivedAt && elapsed != null && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Timer className="h-2.5 w-2.5" /> In Transit
                </p>
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatDuration(elapsed)}
                </p>
              </div>
            )}
            {d.arrivedAt && (
              <>
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Arrived
                  </p>
                  <p className="text-xs font-medium tabular-nums">
                    {new Date(d.arrivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                {d.departedAt && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Timer className="h-2.5 w-2.5" /> Journey Time
                    </p>
                    <p className="text-xs font-semibold tabular-nums">
                      {formatDuration(Math.round((new Date(d.arrivedAt).getTime() - new Date(d.departedAt).getTime()) / 60000))}
                    </p>
                  </div>
                )}
              </>
            )}
            {avgSpeed != null && (
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Gauge className="h-2.5 w-2.5" /> Avg Speed
                </p>
                <p className="text-xs font-medium tabular-nums">{avgSpeed} km/h</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GpsTracking() {
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const [selectedTracker, setSelectedTracker] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [viewMode, setViewMode] = useState<"vehicles" | "trackers">("trackers");

  const { data: vehicles, isLoading, refetch, isFetching } = useQuery({
    queryKey: KEYS.vehicles(),
    queryFn: listVehicleGpsStatus,
    refetchInterval: 30_000,
  });

  const { data: liveTrackers, isLoading: loadingTrackers, refetch: refetchTrackers, isFetching: isFetchingTrackers } = useQuery({
    queryKey: ["gps-trace-live"],
    queryFn: listGpsTraceLive,
    refetchInterval: 30_000,
    enabled: viewMode === "trackers",
  });

  const { data: track, isLoading: loadingTrack } = useQuery({
    queryKey: ["gps-track", selectedVehicle],
    queryFn: () => listGpsTrack(selectedVehicle ?? undefined, 100),
    enabled: !!selectedVehicle && viewMode === "vehicles",
    refetchInterval: 30_000,
  });

  const vehicleList: any[] = Array.isArray(vehicles) ? vehicles : [];
  const trackerList: any[] = Array.isArray(liveTrackers) ? liveTrackers : [];
  const trackPoints: any[] = Array.isArray(track) ? (track as any[]).slice().reverse() : [];
  const selectedData = vehicleList.find((v: any) => v.id === selectedVehicle);
  const liveCount = vehicleList.filter((v: any) => getSignalTier(v.lastPing) === "live").length;
  const arrivedCount = vehicleList.filter((v: any) => getArrivalStatus(v) === "arrived").length;
  const trackerLiveCount = trackerList.filter(t => getSignalTier(t.recordedAt) === "live").length;
  const trackerWithPos = trackerList.filter(t => t.lat != null && t.lng != null).length;

  const isRefreshing = viewMode === "vehicles" ? isFetching : isFetchingTrackers;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live GPS Tracking"
        subtitle="Real-time positions from all GPS-Trace accounts. Refreshes every 30 seconds."
        badge={
          viewMode === "trackers" && trackerLiveCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              {trackerLiveCount} live
            </span>
          ) : viewMode === "vehicles" && liveCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              {liveCount} live
            </span>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant={showSetup ? "default" : "outline"} className="h-8"
              onClick={() => setShowSetup(s => !s)}
            >
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              {showSetup ? "Hide Setup" : "Tracker Setup"}
            </Button>
            <Button
              size="sm" variant="outline" className="h-8"
              onClick={() => viewMode === "vehicles" ? refetch() : refetchTrackers()}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* View mode tab toggle */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-muted w-fit">
        <button
          onClick={() => { setViewMode("trackers"); setSelectedVehicle(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            viewMode === "trackers"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Radio className="h-3.5 w-3.5" />
          All Trackers
          {trackerList.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-semibold">{trackerList.length}</span>
          )}
        </button>
        <button
          onClick={() => { setViewMode("vehicles"); setSelectedTracker(null); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            viewMode === "vehicles"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Truck className="h-3.5 w-3.5" />
          Dispatched Vehicles
          {vehicleList.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">{vehicleList.length}</span>
          )}
        </button>
      </div>

      {showSetup && <GpsTracePanel />}

      {/* ── ALL TRACKERS MODE ─────────────────────────────────────────────── */}
      {viewMode === "trackers" && (
        <>
          {/* Summary strip */}
          {!loadingTrackers && trackerList.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Trackers",      value: trackerList.length, cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-900/20" },
                { label: "With Position", value: trackerWithPos,      cls: "text-teal-700",   bg: "bg-teal-50 dark:bg-teal-900/20" },
                { label: "Live Signal",   value: trackerLiveCount,    cls: "text-emerald-700",bg: "bg-emerald-50 dark:bg-emerald-900/20" },
              ].map((s) => (
                <Card key={s.label} className={`${s.bg} border-transparent`}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Tracker list */}
            <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto pr-1">
              <div className="flex items-center gap-2 mb-2 sticky top-0 bg-background/95 py-1">
                <Radio className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold">GPS Trackers</h2>
                {!loadingTrackers && (
                  <span className="ml-auto text-xs text-muted-foreground">{trackerList.length} units</span>
                )}
              </div>
              {loadingTrackers ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-3"><Skeleton className="h-16 w-full" /></CardContent></Card>
                ))
              ) : trackerList.length === 0 ? (
                <Card>
                  <CardContent className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                    <Radio className="h-10 w-10 opacity-20" />
                    <p className="text-sm">No trackers found</p>
                  </CardContent>
                </Card>
              ) : trackerList.map((t: any) => (
                <TrackerCard
                  key={t.id}
                  t={t}
                  isSelected={selectedTracker === t.id}
                  onSelect={() => setSelectedTracker(selectedTracker === t.id ? null : t.id)}
                />
              ))}
            </div>

            {/* Tracker map */}
            <div className="lg:col-span-2">
              <Card className="overflow-hidden">
                <div className="h-[560px] w-full">
                  {loadingTrackers ? (
                    <Skeleton className="h-full w-full rounded-none" />
                  ) : (
                    <TrackerMap
                      trackers={trackerList}
                      selectedId={selectedTracker}
                      onSelect={setSelectedTracker}
                    />
                  )}
                </div>
                <div className="px-4 py-2 border-t bg-muted/30 flex items-center gap-4 flex-wrap">
                  {(["live", "recent", "stale", "offline"] as const).map(t => (
                    <span key={t} className="flex items-center gap-1.5 text-[10px] text-muted-foreground capitalize">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: TIER_HEX[t] }} />
                      {t}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {trackerWithPos} of {trackerList.length} trackers have a position fix
                  </span>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* ── DISPATCHED VEHICLES MODE ──────────────────────────────────────── */}
      {viewMode === "vehicles" && (
        <>
          {!isLoading && vehicleList.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Vehicles",    value: vehicleList.length, cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-900/20" },
                { label: "Arrived",     value: arrivedCount,        cls: "text-teal-700",   bg: "bg-teal-50 dark:bg-teal-900/20" },
                { label: "Live Signal", value: liveCount,           cls: "text-emerald-700",bg: "bg-emerald-50 dark:bg-emerald-900/20" },
              ].map((s) => (
                <Card key={s.label} className={`${s.bg} border-transparent`}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-1 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Truck className="h-4 w-4 text-green-600" />
                <h2 className="text-sm font-semibold">Vehicles</h2>
                {!isLoading && (
                  <span className="ml-auto text-xs text-muted-foreground">{vehicleList.length} tracked</span>
                )}
              </div>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
                ))
              ) : vehicleList.length === 0 ? (
                <Card>
                  <CardContent className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                    <Truck className="h-10 w-10 opacity-20" />
                    <div className="text-center">
                      <p className="text-sm font-medium">No vehicles in transit</p>
                      <p className="text-xs mt-1">GPS data appears here when vehicles are dispatched.</p>
                    </div>
                  </CardContent>
                </Card>
              ) : vehicleList.map((v: any) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  isSelected={selectedVehicle === v.id}
                  onSelect={() => setSelectedVehicle(selectedVehicle === v.id ? null : v.id)}
                />
              ))}
            </div>

            <div className="lg:col-span-2 space-y-4">
              <Card className="overflow-hidden">
                <div className="h-[480px] w-full">
                  {isLoading ? (
                    <Skeleton className="h-full w-full rounded-none" />
                  ) : (
                    <VehicleMap
                      vehicles={vehicleList}
                      selectedVehicle={selectedVehicle}
                      trackPoints={trackPoints}
                      selectedData={selectedData}
                      onSelect={setSelectedVehicle}
                    />
                  )}
                </div>
                <div className="px-4 py-2 border-t bg-muted/30 flex items-center gap-4 flex-wrap">
                  {(["live", "recent", "stale", "offline"] as const).map(t => (
                    <span key={t} className="flex items-center gap-1.5 text-[10px] text-muted-foreground capitalize">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: TIER_HEX[t] }} />
                      {t}
                    </span>
                  ))}
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
                    <span className="w-2.5 h-2.5 rounded-full inline-block bg-teal-500" />
                    Destination
                  </span>
                  {vehicleList.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">No vehicles in transit — dispatch a vehicle to see it here</span>
                  )}
                </div>
              </Card>

              {selectedVehicle && selectedData && (
                <SelectedVehiclePanel data={selectedData} trackPoints={trackPoints} />
              )}
              {selectedVehicle && selectedData && (
                <TripHistoryPanel
                  vehicleId={selectedVehicle}
                  plateNumber={selectedData.plateNumber ?? `Vehicle #${selectedVehicle}`}
                />
              )}
              {selectedVehicle && (
                <Card>
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Truck className="h-3.5 w-3.5 text-emerald-700" />
                      </div>
                      {selectedData?.plateNumber ?? `Vehicle #${selectedVehicle}`} — GPS History
                      {loadingTrack && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {loadingTrack ? (
                      <div className="space-y-2">
                        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                      </div>
                    ) : trackPoints.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                        <Radio className="h-7 w-7 opacity-20" />
                        <p className="text-sm">No GPS pings recorded yet.</p>
                      </div>
                    ) : (
                      <div className="max-h-[320px] overflow-y-auto divide-y">
                        {trackPoints.map((pt: any, i: number) => (
                          <GpsHistoryRow key={pt.id ?? i} pt={pt} isFirst={i === 0} />
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
