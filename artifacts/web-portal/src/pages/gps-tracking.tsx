import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listVehicleGpsStatus, listGpsTrack, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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

function SignalIndicator({ lastPing }: { lastPing: string | null | undefined }) {
  if (!lastPing) return <WifiOff className="h-3.5 w-3.5 text-slate-400" />;
  const mins = (Date.now() - new Date(lastPing).getTime()) / 60000;
  if (mins < 5)  return <Wifi className="h-3.5 w-3.5 text-emerald-500" />;
  if (mins < 30) return <Wifi className="h-3.5 w-3.5 text-amber-500" />;
  return <WifiOff className="h-3.5 w-3.5 text-red-500" />;
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
        <div className={`w-2.5 h-2.5 rounded-full mt-0.5 ${index === 0 ? "bg-green-600" : "bg-slate-300"}`} />
        {!isLast && <div className="w-px flex-1 bg-slate-200 mt-1 min-h-[20px]" />}
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Live Vehicle Tracking</h1>
          <p className="text-sm text-muted-foreground">Real-time GPS positions for in-transit vehicles. Refreshes every 30 seconds.</p>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold">In-Transit Vehicles</h2>
            {!isLoading && (
              <span className="ml-auto text-xs text-muted-foreground">{vehicleList.length} active</span>
            )}
          </div>

          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
            ))
          ) : vehicleList.length === 0 ? (
            <Card>
              <CardContent className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                <Truck className="h-10 w-10 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-medium">No vehicles in transit</p>
                  <p className="text-xs mt-1">GPS data will appear here when vehicles are dispatched.</p>
                </div>
              </CardContent>
            </Card>
          ) : vehicleList.map((v: any) => (
            <Card
              key={v.id}
              className={`cursor-pointer transition-all hover:shadow-md ${selectedVehicle === v.id ? "ring-2 ring-green-600 shadow-md" : ""}`}
              onClick={() => setSelectedVehicle(selectedVehicle === v.id ? null : v.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                      <Truck className="h-4 w-4 text-green-700 dark:text-green-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{v.plateNumber ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground truncate">{v.vehicleType ?? "Vehicle"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <SignalIndicator lastPing={v.lastPing} />
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedVehicle === v.id ? "rotate-90" : ""}`} />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Position</p>
                    <CoordDisplay lat={v.lastLatitude} lng={v.lastLongitude} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Last ping</p>
                    <p className="text-xs font-medium">{formatAgo(v.lastPing)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2">
          {!selectedVehicle ? (
            <Card className="h-full min-h-[300px]">
              <CardContent className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground p-12">
                <MapPin className="h-12 w-12 opacity-15" />
                <div className="text-center">
                  <p className="text-sm font-medium">Select a vehicle</p>
                  <p className="text-xs mt-1">Click any vehicle on the left to see its GPS track history.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      Track History — {selectedData?.plateNumber ?? `Vehicle #${selectedVehicle}`}
                    </CardTitle>
                    {selectedData?.vehicleType && (
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedData.vehicleType}</p>
                    )}
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
