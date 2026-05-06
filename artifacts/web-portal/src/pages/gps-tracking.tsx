import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listVehicleGpsStatus, listGpsTrack, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import {
  Truck, MapPin, Radio, Clock, Gauge, Navigation,
  ChevronRight, RefreshCw, Wifi, WifiOff,
} from "lucide-react";

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

function LivePulse({ tier }: { tier: "live" | "recent" | "stale" | "offline" }) {
  const c = SIGNAL_CONFIG[tier];
  if (tier === "live") {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.dot}`} />
      </span>
    );
  }
  return <span className={`inline-flex rounded-full h-2.5 w-2.5 shrink-0 ${c.dot}`} />;
}

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

function CoordDisplay({ lat, lng }: { lat: number | null | undefined; lng: number | null | undefined }) {
  if (lat == null || lng == null) return <span className="text-xs text-muted-foreground">No position</span>;
  return (
    <span className="font-mono text-xs tabular-nums">
      {lat.toFixed(5)}, {lng.toFixed(5)}
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

export default function GpsTracking() {
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  const { data: vehicles, isLoading, refetch, isFetching } = useQuery({
    queryKey: KEYS.vehicles(),
    queryFn: listVehicleGpsStatus,
    refetchInterval: 30_000,
  });

  const { data: track, isLoading: loadingTrack } = useQuery({
    queryKey: ["gps-track", selectedVehicle],
    queryFn: () => listGpsTrack(selectedVehicle ?? undefined, 50),
    enabled: !!selectedVehicle,
    refetchInterval: 30_000,
  });

  const vehicleList: any[] = Array.isArray(vehicles) ? vehicles : [];
  const trackPoints: any[] = Array.isArray(track) ? (track as any[]).slice().reverse() : [];
  const selectedData = vehicleList.find((v: any) => v.id === selectedVehicle);
  const liveCount = vehicleList.filter((v: any) => getSignalTier(v.lastPing) === "live").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Live Vehicle Tracking"
        subtitle="Real-time GPS positions for in-transit vehicles. Refreshes every 30 seconds."
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
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))
          ) : vehicleList.length === 0 ? (
            <Card>
              <CardContent className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                <Truck className="h-10 w-10 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-medium">No vehicles in transit</p>
                  <p className="text-xs mt-1 text-muted-foreground">GPS data will appear here when vehicles are dispatched.</p>
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
                onClick={() => setSelectedVehicle(isSelected ? null : v.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
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
                        <p className="text-xs text-muted-foreground truncate">{v.vehicleType ?? "Vehicle"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SignalBadge lastPing={v.lastPing} />
                      <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                    <div>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5"><MapPin className="h-2.5 w-2.5" /> Position</p>
                      <CoordDisplay lat={v.lastLatitude} lng={v.lastLongitude} />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5"><Clock className="h-2.5 w-2.5" /> Last ping</p>
                      <p className="text-xs font-medium">{formatAgo(v.lastPing)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Track history panel */}
        <div className="lg:col-span-2">
          {!selectedVehicle ? (
            <Card className="h-full min-h-[300px]">
              <CardContent className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-12">
                <div className="relative">
                  <MapPin className="h-12 w-12 opacity-10" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Select a vehicle</p>
                  <p className="text-xs mt-1 text-muted-foreground">Click any vehicle card to see its GPS track history.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
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
                        {selectedData?.plateNumber ?? `Vehicle #${selectedVehicle}`}
                      </CardTitle>
                      {selectedData?.vehicleType && (
                        <p className="text-xs text-muted-foreground mt-0.5">{selectedData.vehicleType}</p>
                      )}
                    </div>
                  </div>
                  {selectedData?.lastLatitude != null && (
                    <a
                      href={`https://www.google.com/maps?q=${selectedData.lastLatitude},${selectedData.lastLongitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <MapPin className="h-3.5 w-3.5 mr-1" /> Open in Maps
                      </Button>
                    </a>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingTrack ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : trackPoints.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                    <Radio className="h-8 w-8 opacity-20" />
                    <p className="text-sm">No GPS pings recorded yet for this vehicle.</p>
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto pr-2">
                    {trackPoints.map((pt: any, i: number) => (
                      <TrackPoint key={pt.id ?? i} point={pt} index={i} isLast={i === trackPoints.length - 1} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
