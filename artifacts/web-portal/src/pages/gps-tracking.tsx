import { useListVehicleGpsStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin } from "lucide-react";

export default function GpsTracking() {
  const { data: gpsData, isLoading } = useListVehicleGpsStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Live GPS Tracking</h1>
        <p className="text-muted-foreground">Monitor real-time vehicle locations and status.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle>Map View</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 m-6 border border-dashed rounded-lg bg-muted/20 flex items-center justify-center relative overflow-hidden">
              <div className="text-center text-muted-foreground z-10 p-4 bg-background/80 rounded-lg backdrop-blur-sm shadow-sm">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="font-medium">Map Component Placeholder</p>
                <p className="text-xs">Leaflet/Google Maps integration would go here</p>
              </div>
              
              {/* Simulated GPS dots on the placeholder map */}
              {!isLoading && gpsData && gpsData.map((v, i) => (
                <div 
                  key={v.vehicleId} 
                  className="absolute w-3 h-3 bg-primary rounded-full animate-pulse"
                  style={{ 
                    left: `${20 + (i * 15)}%`, 
                    top: `${30 + (i * 20)}%` 
                  }}
                  title={v.vehiclePlate}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle>Vehicle Status</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <div className="space-y-4">
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex flex-col space-y-2 border-b pb-4">
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-5 w-24" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  ))
                ) : gpsData && gpsData.length > 0 ? (
                  gpsData.map((vehicle) => (
                    <div key={vehicle.vehicleId} className="flex flex-col border-b pb-4 last:border-0 last:pb-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold">{vehicle.vehiclePlate}</span>
                        <Badge variant={
                          vehicle.status === 'Active' ? 'default' : 
                          vehicle.status === 'InTransit' ? 'secondary' : 'outline'
                        }>
                          {vehicle.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground mb-1">
                        {vehicle.driverName || 'Unknown Driver'}
                      </div>
                      <div className="text-xs space-y-1">
                        {vehicle.campaignName && (
                          <div><span className="font-medium text-foreground">Campaign:</span> {vehicle.campaignName}</div>
                        )}
                        <div><span className="font-medium text-foreground">Speed:</span> {vehicle.speed || 0} km/h</div>
                        <div><span className="font-medium text-foreground">Last Ping:</span> {new Date(vehicle.lastPing).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No active vehicle signals.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
