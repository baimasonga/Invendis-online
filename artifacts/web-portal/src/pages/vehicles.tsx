import { useListVehicles, useListDrivers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Vehicles() {
  const { data: vehicles, isLoading: isLoadingVehicles } = useListVehicles();
  const { data: drivers, isLoading: isLoadingDrivers } = useListDrivers();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fleet Management</h1>
          <p className="text-muted-foreground">Manage vehicles and drivers for distribution.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Vehicle
        </Button>
      </div>

      <Tabs defaultValue="vehicles">
        <TabsList>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
        </TabsList>
        
        <TabsContent value="vehicles" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Registered Vehicles</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Plate</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingVehicles ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    ) : vehicles && vehicles.length > 0 ? (
                      vehicles.map((vehicle) => (
                        <TableRow key={vehicle.id}>
                          <TableCell className="font-medium">{vehicle.vehicleCode}</TableCell>
                          <TableCell>{vehicle.plateNumber}</TableCell>
                          <TableCell>{vehicle.vehicleType}</TableCell>
                          <TableCell>{vehicle.driverName || 'Unassigned'}</TableCell>
                          <TableCell>
                            <Badge variant={vehicle.status === 'Active' ? 'default' : 'secondary'}>
                              {vehicle.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          No vehicles found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drivers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Registered Drivers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>License</TableHead>
                      <TableHead>Assigned Vehicle</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingDrivers ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    ) : drivers && drivers.length > 0 ? (
                      drivers.map((driver) => (
                        <TableRow key={driver.id}>
                          <TableCell className="font-medium">{driver.fullName}</TableCell>
                          <TableCell>{driver.phone || '-'}</TableCell>
                          <TableCell>{driver.licenseNumber || '-'}</TableCell>
                          <TableCell>{driver.vehiclePlate || 'Unassigned'}</TableCell>
                          <TableCell>
                            <Badge variant={driver.isActive ? 'default' : 'secondary'}>
                              {driver.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          No drivers found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
