import { useListVehicles, useListDrivers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Truck, User } from "lucide-react";

const VEHICLE_STATUS_STYLES: Record<string, string> = {
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  intransit: "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  maintenance:"bg-amber-100 text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
  inactive:  "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  const cls = VEHICLE_STATUS_STYLES[status?.toLowerCase().replace(/\s+/g, "")] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function VehicleTypeIcon({ type }: { type?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
        <Truck className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
      </div>
      <span className="text-sm">{type ?? "—"}</span>
    </div>
  );
}

function DriverAvatar({ name }: { name?: string }) {
  if (!name) return <span className="text-sm text-muted-foreground">—</span>;
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 text-xs font-semibold shrink-0">
        {initials}
      </span>
      <span className="text-sm">{name}</span>
    </div>
  );
}

export default function Vehicles() {
  const { data: vehicles, isLoading: loadingVehicles } = useListVehicles();
  const { data: drivers, isLoading: loadingDrivers } = useListDrivers();

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Fleet Management</h1>
          <p className="text-sm text-muted-foreground">Vehicles and drivers for distribution operations.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Vehicle
        </Button>
      </div>

      {/* Quick stats */}
      {!loadingVehicles && !loadingDrivers && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                <Truck className="h-4 w-4 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{(vehicles as any[])?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Vehicles</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                <User className="h-4 w-4 text-indigo-700 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold leading-none">{(drivers as any[])?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Drivers</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="vehicles">
        <TabsList className="h-8">
          <TabsTrigger value="vehicles" className="text-xs">Vehicles</TabsTrigger>
          <TabsTrigger value="drivers" className="text-xs">Drivers</TabsTrigger>
        </TabsList>

        <TabsContent value="vehicles" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[120px]">Code</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead className="hidden md:table-cell">Type</TableHead>
                    <TableHead className="hidden lg:table-cell">Capacity</TableHead>
                    <TableHead className="hidden md:table-cell">Driver</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingVehicles
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    : vehicles && (vehicles as any[]).length > 0
                    ? (vehicles as any[]).map((v: any) => (
                        <TableRow key={v.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{v.vehicleCode}</TableCell>
                          <TableCell className="font-semibold text-sm">{v.plateNumber}</TableCell>
                          <TableCell className="hidden md:table-cell"><VehicleTypeIcon type={v.vehicleType} /></TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{v.capacityKg ? `${v.capacityKg} kg` : "—"}</TableCell>
                          <TableCell className="hidden md:table-cell"><DriverAvatar name={v.driverName} /></TableCell>
                          <TableCell className="pr-4"><StatusBadge status={v.status} /></TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Truck className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No vehicles found</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drivers" className="mt-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden lg:table-cell">Licence</TableHead>
                    <TableHead className="hidden md:table-cell">Assigned Vehicle</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDrivers
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    : drivers && (drivers as any[]).length > 0
                    ? (drivers as any[]).map((d: any) => (
                        <TableRow key={d.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4"><DriverAvatar name={d.fullName} /></TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{d.phone ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{d.licenseNumber ?? "—"}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm">
                            {d.vehiclePlate
                              ? <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{d.vehiclePlate}</span>
                              : <span className="text-muted-foreground">Unassigned</span>}
                          </TableCell>
                          <TableCell className="pr-4">
                            <StatusBadge status={d.isActive ? "Active" : "Inactive"} />
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <User className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No drivers found</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
