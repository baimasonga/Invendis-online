import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listVehicleGpsStatus, listGpsTrack, listGpsTraceDevices, syncGpsTrace, linkGpsTraceDevice, unlinkGpsTraceDevice, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, MapPin, Radio, Clock, Gauge, Navigation,
  ChevronRight, RefreshCw, Wifi, WifiOff, Target,
  AlertTriangle, CheckCircle2, RouteOff, Link2, Link2Off,
  Satellite, PlugZap,
} from "lucide-react";

declare global {
  interface Window { L: any; }
}

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
  live:    { dot: "bg-emerald-500", color: "#10b981", label: "Live",    labelCls: "bg-emerald-100 text-emerald-700", icon: Wifi,    iconCls: "text-emerald-500" },
  recent:  { dot: "bg-amber-400",   color: "#f59e0b", label: "Recent",  labelCls: "bg-amber-100   text-amber-700",   icon: Wifi,    iconCls: "text-amber-500"   },
  stale:   { dot: "bg-orange-400",  color: "#f97316", label: "Stale",   labelCls: "bg-orange-100  text-orange-700",  icon: WifiOff, iconCls: "text-orange-400"  },
  offline: { dot: "bg-slate-300",   color: "#94a3b8", label: "Offline", labelCls: "bg-slate-100   text-slate-500",   icon: WifiOff, iconCls: "text-slate-400"   },
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
  arrived:        { label: "Arrived",        cls: "bg-teal-100  text-teal-700",  icon: CheckCircle2 },
  en_route:       { label: "En Route",       cls: "bg-blue-100  text-blue-700",  icon: Navigation   },
  not_reached:    { label: "Not Reached",    cls: "bg-red-100   text-red-700",   icon: AlertTriangle },
  no_destination: { label: "No Destination", cls: "bg-amber-100 text-amber-700", icon: Target       },
  no_signal:      { label: "No Signal",      cls: "bg-slate-100 text-slate-500", icon: RouteOff     },
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

function TrackPoint({ point, index, isLast }: { point: any; index: number; isLast: boolean }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${index === 0 ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-slate-200"}`} />
        {!isLast && <div className="w-px flex-1 bg-slate-100 mt-1 min-h-[20px]" />}
      </div>
      <div className="pb-4 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs">{point.latitude?.toFixed(5)}, {point.longitude?.toFixed(5)}</span>
          {point.speed != null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Gauge className="h-3 w-3" />{point.speed} km/h
            </span>
          )}
          {point.heading != null && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Navigation className="h-3 w-3" />{point.heading}°
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {new Date(point.recordedAt).toLocaleString("en-GB", {
            day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

// ── Leaflet Map ───────────────────────────────────────────────────────────────

function vehicleMarkerHtml(color: string, selected: boolean, plate: string): string {
  const ring = selected ? `box-shadow:0 0 0 3px #fff,0 0 0 5px ${color};` : "";
  return `<div style="width:36px;height:36px;background:${color};border-radius:50%;display:flex;align-items:center;justify-content:center;${ring}box-shadow:0 2px 8px rgba(0,0,0,0.35);" title="${plate}">
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1"/>
      <path d="M16 8h4l3 5v3h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  </div>`;
}

function destMarkerHtml(label: string): string {
  return `<div style="display:flex;flex-direction:column;align-items:center;" title="${label}">
    <div style="width:30px;height:30px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/>
      </svg>
    </div>
    <div style="width:2px;height:10px;background:#0d9488;margin-top:-1px;"></div>
  </div>`;
}

interface GpsMapProps {
  vehicles: any[];
  selectedId: number | null;
  onSelectVehicle: (id: number) => void;
}

function GpsMap({ vehicles, selectedId, onSelectVehicle }: GpsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const vehicleMarkersRef = useRef<Record<number, any>>({});
  const destMarkersRef    = useRef<Record<number, any>>({});
  const routeLineRef      = useRef<any>(null);
  const trackLineRef      = useRef<any>(null);
  const initialFitDone    = useRef(false);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const L = window.L;
    if (!L) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      maxZoom: 19,
    }).addTo(map);
    map.setView([8.46, -11.77], 9); // Bo, Sierra Leone default
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      initialFitDone.current = false;
    };
  }, []);

  // Sync markers whenever vehicles or selection changes
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    // Remove stale vehicle markers
    Object.keys(vehicleMarkersRef.current).forEach(idStr => {
      const id = Number(idStr);
      if (!vehicles.find(v => v.id === id)) {
        vehicleMarkersRef.current[id]?.remove();
        delete vehicleMarkersRef.current[id];
      }
    });
    // Remove stale dest markers
    Object.keys(destMarkersRef.current).forEach(idStr => {
      const id = Number(idStr);
      if (!vehicles.find(v => v.id === id)) {
        destMarkersRef.current[id]?.remove();
        delete destMarkersRef.current[id];
      }
    });

    // Remove old route line
    if (routeLineRef.current) { routeLineRef.current.remove(); routeLineRef.current = null; }

    const allLatLngs: [number, number][] = [];

    vehicles.forEach(v => {
      const tier = getSignalTier(v.lastPing);
      const color = SIGNAL_CONFIG[tier].color;
      const isSelected = v.id === selectedId;
      const plate = v.plateNumber ?? `#${v.id}`;

      // ── Vehicle marker ──
      if (v.lastLatitude != null && v.lastLongitude != null) {
        allLatLngs.push([v.lastLatitude, v.lastLongitude]);
        const icon = L.divIcon({
          className: "",
          html: vehicleMarkerHtml(color, isSelected, plate),
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          popupAnchor: [0, -20],
        });

        if (vehicleMarkersRef.current[v.id]) {
          vehicleMarkersRef.current[v.id].setLatLng([v.lastLatitude, v.lastLongitude]);
          vehicleMarkersRef.current[v.id].setIcon(icon);
        } else {
          const m = L.marker([v.lastLatitude, v.lastLongitude], { icon }).addTo(map);
          m.bindTooltip(
            `<b>${plate}</b><br/>${v.vehicleType ?? "Vehicle"}${v.driverName ? " · " + v.driverName : ""}<br/><span style="color:${color}">${SIGNAL_CONFIG[tier].label}</span> · ${formatAgo(v.lastPing)}`,
            { direction: "top", offset: [0, -20] }
          );
          m.on("click", () => onSelectVehicle(v.id));
          vehicleMarkersRef.current[v.id] = m;
        }
      }

      // ── Destination marker ──
      if (v.effectiveDestLat != null && v.effectiveDestLng != null) {
        allLatLngs.push([v.effectiveDestLat, v.effectiveDestLng]);
        const destLabel = v.destinationLabel ?? "Destination";
        const dIcon = L.divIcon({
          className: "",
          html: destMarkerHtml(destLabel),
          iconSize: [30, 40],
          iconAnchor: [15, 40],
          popupAnchor: [0, -44],
        });

        if (destMarkersRef.current[v.id]) {
          destMarkersRef.current[v.id].setLatLng([v.effectiveDestLat, v.effectiveDestLng]);
          destMarkersRef.current[v.id].setIcon(dIcon);
        } else {
          const dm = L.marker([v.effectiveDestLat, v.effectiveDestLng], { icon: dIcon }).addTo(map);
          dm.bindTooltip(
            `<b>${destLabel}</b><br/>${v.effectiveDestLat?.toFixed(4)}, ${v.effectiveDestLng?.toFixed(4)}`,
            { direction: "top", offset: [0, -44] }
          );
          destMarkersRef.current[v.id] = dm;
        }

        // Route line from vehicle to destination for selected vehicle
        if (isSelected && v.lastLatitude != null) {
          routeLineRef.current = L.polyline(
            [[v.lastLatitude, v.lastLongitude], [v.effectiveDestLat, v.effectiveDestLng]],
            { color: "#3b82f6", weight: 2.5, dashArray: "8 6", opacity: 0.75 }
          ).addTo(map);
        }
      }
    });

    // Fit bounds on first load
    if (!initialFitDone.current && allLatLngs.length > 0) {
      initialFitDone.current = true;
      if (allLatLngs.length === 1) {
        map.setView(allLatLngs[0], 13);
      } else {
        map.fitBounds(allLatLngs, { padding: [50, 50], maxZoom: 14 });
      }
    }
  }, [vehicles, selectedId, onSelectVehicle]);

  // Pan to selected vehicle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sel = vehicles.find(v => v.id === selectedId);
    if (sel?.lastLatitude != null) {
      map.panTo([sel.lastLatitude, sel.lastLongitude], { animate: true, duration: 0.6 });
    }
  }, [selectedId, vehicles]);

  // Draw GPS track polyline
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    if (trackLineRef.current) { trackLineRef.current.remove(); trackLineRef.current = null; }
  }, [selectedId]);

  return (
    <div className="relative rounded-xl overflow-hidden border">
      <div ref={containerRef} style={{ height: 420, width: "100%" }} />
      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-3 text-[10px] font-medium shadow border z-[1000]">
        {(["live","recent","stale","offline"] as const).map(tier => (
          <span key={tier} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SIGNAL_CONFIG[tier].color }} />
            {SIGNAL_CONFIG[tier].label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-teal-600" />
          Destination
        </span>
      </div>
    </div>
  );
}

// ── Tracker Setup Tab ─────────────────────────────────────────────────────────

function TrackerSetup() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [linkingDeviceId, setLinkingDeviceId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["gpstrace-devices"],
    queryFn: listGpsTraceDevices,
    retry: 1,
  });

  const syncMut = useMutation({
    mutationFn: syncGpsTrace,
    onSuccess: (result) => {
      toast({ title: `Synced ${result.synced} position${result.synced !== 1 ? "s" : ""} from GPS-Trace` });
      qc.invalidateQueries({ queryKey: KEYS.gpsVehicles() });
      qc.invalidateQueries({ queryKey: ["gpstrace-devices"] });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const linkMut = useMutation({
    mutationFn: ({ vehicleId, deviceId, deviceName }: { vehicleId: number; deviceId: string; deviceName?: string }) =>
      linkGpsTraceDevice(vehicleId, deviceId, deviceName),
    onSuccess: () => {
      toast({ title: "Tracker linked successfully" });
      setLinkingDeviceId(null);
      refetch();
    },
    onError: (err: any) => toast({ title: "Link failed", description: err.message, variant: "destructive" }),
  });

  const unlinkMut = useMutation({
    mutationFn: (vehicleId: number) => unlinkGpsTraceDevice(vehicleId),
    onSuccess: () => { toast({ title: "Tracker unlinked" }); refetch(); },
    onError: (err: any) => toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (error || !data?.configured) {
    return (
      <Card className="mt-4 border-amber-200 bg-amber-50/50">
        <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
          <PlugZap className="h-10 w-10 text-amber-400 opacity-60" />
          <div>
            <p className="text-sm font-semibold">GPS-Trace not configured</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Set the <code className="bg-muted px-1 rounded text-[11px]">GPSTRACE_TOKEN</code> environment variable on the API server to connect your GPS-Trace account.
              <br />Generate a token in GPS-Trace → My Account → API Access.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const devices: any[] = data.devices ?? [];
  const vehicles: any[] = data.vehicles ?? [];

  return (
    <div className="mt-4 space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Satellite className="h-4 w-4 text-blue-600" />
          <p className="text-sm font-semibold">GPS-Trace Tracker Units</p>
          {devices.length > 0 && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
              {devices.length} unit{devices.length !== 1 ? "s" : ""} found
            </span>
          )}
        </div>
        <Button
          size="sm" variant="outline" className="h-8"
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending || isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMut.isPending ? "animate-spin" : ""}`} />
          {syncMut.isPending ? "Syncing…" : "Sync Positions Now"}
        </Button>
      </div>

      {devices.length > 0 && (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <Satellite className="h-3.5 w-3.5 shrink-0" />
          {devices.length} tracker unit{devices.length !== 1 ? "s" : ""} found in GPS-Trace account. Link each unit to a vehicle below.
        </p>
      )}

      {/* Device cards */}
      {devices.length === 0 ? (
        <Card>
          <CardContent className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
            <Satellite className="h-10 w-10 opacity-20" />
            <p className="text-sm">No tracker units found in your GPS-Trace account.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {devices.map((device: any) => {
            const linked: any = device.linkedVehicle;
            const isLinkingThis = linkingDeviceId === device.deviceId;
            return (
              <Card key={device.deviceId} className={linked ? "border-emerald-200 bg-emerald-50/30" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${linked ? "bg-emerald-100" : "bg-slate-100"}`}>
                        <Satellite className={`h-4 w-4 ${linked ? "text-emerald-700" : "text-slate-500"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{device.deviceName}</p>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {device.deviceId}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {device.lastSeen ? (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {formatAgo(device.lastSeen)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Never seen</span>
                          )}
                          {device.latitude != null && (
                            <span className="text-xs font-mono text-muted-foreground">{device.latitude.toFixed(4)}, {device.longitude.toFixed(4)}</span>
                          )}
                          {device.speed != null && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Gauge className="h-3 w-3" /> {device.speed} km/h
                            </span>
                          )}
                        </div>
                        {linked && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Link2 className="h-3 w-3 text-emerald-600" />
                            <p className="text-xs font-medium text-emerald-700">
                              Linked to {linked.plate_number} ({linked.vehicle_code})
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      {linked ? (
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => unlinkMut.mutate(linked.id)}
                          disabled={unlinkMut.isPending}
                        >
                          <Link2Off className="h-3.5 w-3.5 mr-1" /> Unlink
                        </Button>
                      ) : (
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                          onClick={() => setLinkingDeviceId(isLinkingThis ? null : device.deviceId)}
                        >
                          <Link2 className="h-3.5 w-3.5 mr-1" /> Link Tracker
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Vehicle picker */}
                  {isLinkingThis && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium mb-2 text-muted-foreground">Select vehicle to link this tracker to:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                        {vehicles
                          .filter((v: any) => !v.gps_device_id || v.gps_device_id === device.deviceId)
                          .map((v: any) => (
                            <button
                              key={v.id}
                              className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-left transition-colors"
                              onClick={() => linkMut.mutate({ vehicleId: v.id, deviceId: device.deviceId, deviceName: device.deviceName })}
                              disabled={linkMut.isPending}
                            >
                              <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold leading-tight">{v.plate_number}</p>
                                <p className="text-[10px] text-muted-foreground">{v.vehicle_code}</p>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GpsTracking() {
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  const { data: vehicles, isLoading, refetch, isFetching } = useQuery({
    queryKey: KEYS.gpsVehicles(),
    queryFn: listVehicleGpsStatus,
    refetchInterval: 30_000,
  });

  const { data: track, isLoading: loadingTrack } = useQuery({
    queryKey: ["gps-track", selectedVehicle],
    queryFn: () => listGpsTrack(selectedVehicle ?? undefined, 50),
    enabled: !!selectedVehicle,
    refetchInterval: 30_000,
  });

  const handleSelectVehicle = useCallback((id: number) => {
    setSelectedVehicle(prev => prev === id ? null : id);
  }, []);

  const vehicleList: any[] = Array.isArray(vehicles) ? vehicles : [];
  const trackPoints: any[] = Array.isArray(track) ? (track as any[]) : [];
  const selectedData = vehicleList.find((v: any) => v.id === selectedVehicle);
  const liveCount    = vehicleList.filter((v: any) => getSignalTier(v.lastPing) === "live").length;
  const arrivedCount = vehicleList.filter((v: any) => getArrivalStatus(v) === "arrived").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="GPS Tracking"
        subtitle="Real-time vehicle positions, destination monitoring, and hardware tracker management."
        badge={
          liveCount > 0 ? (
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
          <Button size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <Tabs defaultValue="live">
        <TabsList className="h-8">
          <TabsTrigger value="live" className="text-xs flex items-center gap-1.5">
            <Radio className="h-3 w-3" /> Live Tracking
          </TabsTrigger>
          <TabsTrigger value="trackers" className="text-xs flex items-center gap-1.5">
            <Satellite className="h-3 w-3" /> Tracker Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trackers">
          <TrackerSetup />
        </TabsContent>

        <TabsContent value="live">

      {/* Summary strip */}
      {!isLoading && vehicleList.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "In Transit",  value: vehicleList.length, cls: "text-blue-700",    bg: "bg-blue-50 dark:bg-blue-900/20"     },
            { label: "Arrived",     value: arrivedCount,        cls: "text-teal-700",    bg: "bg-teal-50 dark:bg-teal-900/20"     },
            { label: "Live Signal", value: liveCount,           cls: "text-emerald-700", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-transparent`}>
              <CardContent className="p-3 text-center">
                <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Map — full width, always visible */}
      {isLoading ? (
        <Skeleton className="w-full rounded-xl" style={{ height: 420 }} />
      ) : (
        <GpsMap
          vehicles={vehicleList}
          selectedId={selectedVehicle}
          onSelectVehicle={handleSelectVehicle}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Vehicle list */}
        <div className="lg:col-span-1 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold">In-Transit Vehicles</h2>
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
                  <p className="text-xs mt-1 text-muted-foreground">GPS data appears here when vehicles are dispatched.</p>
                </div>
              </CardContent>
            </Card>
          ) : vehicleList.map((v: any) => {
            const tier = getSignalTier(v.lastPing);
            const isSelected = selectedVehicle === v.id;
            return (
              <Card
                key={v.id}
                className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? "ring-2 ring-emerald-500 shadow-md" : "hover:border-emerald-200"}`}
                onClick={() => handleSelectVehicle(v.id)}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Row 1: Vehicle identity + signal */}
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

                  {/* Row 2: Position + ping */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                    <div>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5"><MapPin className="h-2.5 w-2.5" /> Current Position</p>
                      {v.lastLatitude != null
                        ? <span className="font-mono text-xs tabular-nums">{v.lastLatitude.toFixed(5)}, {v.lastLongitude.toFixed(5)}</span>
                        : <span className="text-xs text-muted-foreground">No position</span>
                      }
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5"><Clock className="h-2.5 w-2.5" /> Last ping</p>
                      <p className="text-xs font-medium">{formatAgo(v.lastPing)}</p>
                    </div>
                  </div>

                  {/* Row 3: Destination + arrival status */}
                  <div className="pt-2 border-t space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Target className="h-2.5 w-2.5" /> Destination
                      </p>
                      <ArrivalBadge vehicle={v} />
                    </div>
                    {v.destinationLabel ? (
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-medium truncate max-w-[140px]">{v.destinationLabel}</p>
                        {v.distanceLabel && (
                          <p className="text-xs text-muted-foreground tabular-nums">{v.distanceLabel} away</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No distribution site configured</p>
                    )}
                    {v.campaignName && (
                      <p className="text-[10px] text-muted-foreground truncate">{v.campaignName}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-2">
          {!selectedVehicle ? (
            <Card className="h-full min-h-[200px]">
              <CardContent className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-12">
                <MapPin className="h-10 w-10 opacity-10" />
                <div className="text-center">
                  <p className="text-sm font-medium">Select a vehicle</p>
                  <p className="text-xs mt-1 text-muted-foreground">Click a vehicle card or map marker to see GPS track and destination details.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Destination summary card */}
              {selectedData && (
                <Card className={
                  getArrivalStatus(selectedData) === "arrived"
                    ? "border-teal-200 bg-teal-50/50 dark:bg-teal-900/10"
                    : getArrivalStatus(selectedData) === "not_reached"
                    ? "border-red-200 bg-red-50/50 dark:bg-red-900/10"
                    : ""
                }>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1.5 min-w-0">
                        {/* Current location row */}
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1">
                            <MapPin className="h-3 w-3" /> Current Location
                          </p>
                          {selectedData.lastLatitude != null ? (
                            <p className="font-mono text-xs">
                              {selectedData.lastLatitude.toFixed(5)}, {selectedData.lastLongitude?.toFixed(5)}
                              <span className="ml-2 text-muted-foreground font-sans">{formatAgo(selectedData.lastPing)}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No GPS position recorded</p>
                          )}
                        </div>

                        {/* Destination row */}
                        <div className="pt-2 border-t">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                              <Target className="h-3 w-3" /> Destination
                            </p>
                            <ArrivalBadge vehicle={selectedData} />
                          </div>
                          {selectedData.destinationLabel ? (
                            <p className="text-sm font-semibold">{selectedData.destinationLabel}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">No distribution site set on this campaign</p>
                          )}
                          {selectedData.effectiveDestLat != null && (
                            <p className="font-mono text-xs text-muted-foreground mt-0.5">
                              {selectedData.effectiveDestLat.toFixed(5)}, {selectedData.effectiveDestLng?.toFixed(5)}
                            </p>
                          )}
                          {selectedData.distanceLabel && (
                            <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mt-0.5">
                              {selectedData.distanceLabel} from current position
                            </p>
                          )}
                          {selectedData.arrivedAt && (
                            <p className="text-xs text-teal-700 dark:text-teal-400 mt-0.5">
                              Arrived {new Date(selectedData.arrivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                          {selectedData.departedAt && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Departed {new Date(selectedData.departedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Map links */}
                      <div className="flex flex-col gap-2 shrink-0">
                        {selectedData.lastLatitude != null && (
                          <a
                            href={`https://www.google.com/maps?q=${selectedData.lastLatitude},${selectedData.lastLongitude}`}
                            target="_blank" rel="noopener noreferrer"
                          >
                            <Button size="sm" variant="outline" className="h-7 text-xs w-full">
                              <MapPin className="h-3.5 w-3.5 mr-1" /> Vehicle in Maps
                            </Button>
                          </a>
                        )}
                        {selectedData.effectiveDestLat != null && (
                          <a
                            href={`https://www.google.com/maps?q=${selectedData.effectiveDestLat},${selectedData.effectiveDestLng}`}
                            target="_blank" rel="noopener noreferrer"
                          >
                            <Button size="sm" variant="outline" className="h-7 text-xs w-full">
                              <Target className="h-3.5 w-3.5 mr-1" /> Destination in Maps
                            </Button>
                          </a>
                        )}
                        {selectedData.lastLatitude != null && selectedData.effectiveDestLat != null && (
                          <a
                            href={`https://www.google.com/maps/dir/${selectedData.lastLatitude},${selectedData.lastLongitude}/${selectedData.effectiveDestLat},${selectedData.effectiveDestLng}`}
                            target="_blank" rel="noopener noreferrer"
                          >
                            <Button size="sm" variant="outline" className="h-7 text-xs w-full text-blue-600 border-blue-200 hover:bg-blue-50">
                              <Navigation className="h-3.5 w-3.5 mr-1" /> Get Directions
                            </Button>
                          </a>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Track history */}
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <Truck className="h-4 w-4 text-emerald-700" />
                      </div>
                      {getSignalTier(selectedData?.lastPing) === "live" && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">
                        {selectedData?.plateNumber ?? `Vehicle #${selectedVehicle}`} — GPS Track
                      </CardTitle>
                      {selectedData?.manifestCode && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Manifest {selectedData.manifestCode}
                          {selectedData.campaignName ? ` · ${selectedData.campaignName}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {loadingTrack ? (
                    <div className="space-y-3">
                      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                    </div>
                  ) : trackPoints.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                      <Radio className="h-8 w-8 opacity-20" />
                      <p className="text-sm">No GPS pings recorded yet for this vehicle.</p>
                    </div>
                  ) : (
                    <div className="max-h-[320px] overflow-y-auto pr-2">
                      {trackPoints.map((pt: any, i: number) => (
                        <TrackPoint key={pt.id ?? i} point={pt} index={i} isLast={i === trackPoints.length - 1} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
