import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listVehicles, listDrivers, deleteVehicle, deleteDriver, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Truck, User, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { AddVehicleModal } from "@/components/modals/AddVehicleModal";
import { AddDriverModal } from "@/components/modals/AddDriverModal";
import { EditVehicleModal } from "@/components/modals/EditVehicleModal";
import { EditDriverModal } from "@/components/modals/EditDriverModal";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";


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
  const can = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState("vehicles");
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [driverOpen, setDriverOpen]   = useState(false);
  const [editVehicle, setEditVehicle] = useState<any>(null);
  const [editDriver, setEditDriver]   = useState<any>(null);
  const [deleteVehicleTarget, setDeleteVehicleTarget] = useState<any>(null);
  const [deleteDriverTarget, setDeleteDriverTarget]   = useState<any>(null);

  const { data: vehiclesData, isLoading: loadingVehicles } = useQuery({
    queryKey: KEYS.vehicles(),
    queryFn: () => listVehicles(),
  });
  const { data: driversData, isLoading: loadingDrivers } = useQuery({
    queryKey: KEYS.drivers(),
    queryFn: () => listDrivers(),
  });

  const vehicleList: any[] = vehiclesData?.data ?? [];
  const driverList:  any[] = driversData?.data ?? [];

  const deleteVehicleMut = useMutation({ mutationFn: (id: number) => deleteVehicle(id) });
  const deleteDriverMut  = useMutation({ mutationFn: (id: number) => deleteDriver(id) });

  async function handleDeleteVehicle() {
    if (!deleteVehicleTarget) return;
    try {
      await deleteVehicleMut.mutateAsync(deleteVehicleTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.vehicles() });
      toast({ title: "Vehicle deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally { setDeleteVehicleTarget(null); }
  }

  async function handleDeleteDriver() {
    if (!deleteDriverTarget) return;
    try {
      await deleteDriverMut.mutateAsync(deleteDriverTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.drivers() });
      toast({ title: "Driver deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally { setDeleteDriverTarget(null); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Management"
        subtitle="Vehicles and drivers for distribution operations."
        actions={can.manageFleet ? (
          tab === "vehicles" ? (
            <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setVehicleOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Vehicle
            </Button>
          ) : (
            <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setDriverOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Driver
            </Button>
          )
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Truck className="h-4 w-4 text-blue-700 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{loadingVehicles ? "—" : vehicleList.length}</p>
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
              <p className="text-2xl font-bold leading-none">{loadingDrivers ? "—" : driverList.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Drivers</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8">
          <TabsTrigger value="vehicles" className="text-xs">Vehicles</TabsTrigger>
          <TabsTrigger value="drivers"  className="text-xs">Drivers</TabsTrigger>
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
                    <TableHead className="hidden lg:table-cell">Make / Model</TableHead>
                    <TableHead className="hidden lg:table-cell">Capacity</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageFleet && <TableHead className="pr-4 text-right w-[110px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingVehicles
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          {can.manageFleet && <TableCell className="pr-4" />}
                        </TableRow>
                      ))
                    : vehicleList.length > 0
                    ? vehicleList.map((v: any) => (
                        <TableRow key={v.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{v.vehicleCode}</TableCell>
                          <TableCell className="font-semibold text-sm">{v.plateNumber}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                                <Truck className="h-3 w-3 text-blue-700 dark:text-blue-400" />
                              </div>
                              <span className="text-sm">{v.vehicleType}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {v.make || v.model ? `${v.make ?? ""} ${v.model ?? ""}`.trim() : "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {v.capacity ? `${v.capacity} kg` : "—"}
                          </TableCell>
                          <TableCell><StatusBadge status={v.status} /></TableCell>
                          {can.manageFleet && (
                            <TableCell className="pr-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                  onClick={() => setEditVehicle(v)}
                                >
                                  <Pencil className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                                  onClick={() => setDeleteVehicleTarget(v)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={can.manageFleet ? 7 : 6} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Truck className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No vehicles registered</span>
                              {can.manageFleet && (
                                <Button size="sm" variant="outline" onClick={() => setVehicleOpen(true)}>
                                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first vehicle
                                </Button>
                              )}
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
                    <TableHead>Status</TableHead>
                    {can.manageFleet && <TableHead className="pr-4 text-right w-[110px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDrivers
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                          {can.manageFleet && <TableCell className="pr-4" />}
                        </TableRow>
                      ))
                    : driverList.length > 0
                    ? driverList.map((d: any) => (
                        <TableRow key={d.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4"><DriverAvatar name={d.fullName} /></TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{d.phone ?? "—"}</TableCell>
                          <TableCell><StatusBadge status={d.isActive ? "Active" : "Inactive"} /></TableCell>
                          {can.manageFleet && (
                            <TableCell className="pr-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                  onClick={() => setEditDriver(d)}
                                >
                                  <Pencil className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                                  onClick={() => setDeleteDriverTarget(d)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={can.manageFleet ? 6 : 5} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <User className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No drivers registered</span>
                              {can.manageFleet && (
                                <Button size="sm" variant="outline" onClick={() => setDriverOpen(true)}>
                                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first driver
                                </Button>
                              )}
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

      {can.manageFleet && (
        <>
          <AddVehicleModal  open={vehicleOpen}   onClose={() => setVehicleOpen(false)} />
          <AddDriverModal   open={driverOpen}    onClose={() => setDriverOpen(false)} />
          <EditVehicleModal open={!!editVehicle} vehicle={editVehicle} onClose={() => setEditVehicle(null)} />
          <EditDriverModal  open={!!editDriver}  driver={editDriver}   onClose={() => setEditDriver(null)} />
        </>
      )}

      <AlertDialog open={!!deleteVehicleTarget} onOpenChange={(v) => { if (!v) setDeleteVehicleTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete vehicle?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete vehicle{" "}
              <span className="font-semibold">{deleteVehicleTarget?.plateNumber}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteVehicle}
              disabled={deleteVehicleMut.isPending}
            >
              {deleteVehicleMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteDriverTarget} onOpenChange={(v) => { if (!v) setDeleteDriverTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete driver?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete driver{" "}
              <span className="font-semibold">{deleteDriverTarget?.fullName}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDeleteDriver}
              disabled={deleteDriverMut.isPending}
            >
              {deleteDriverMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
