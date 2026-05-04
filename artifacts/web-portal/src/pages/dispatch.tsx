import { useState } from "react";
import { useListDispatches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Dispatch() {
  const [page, setPage] = useState(1);
  const { data: dispatchData, isLoading } = useListDispatches({ page });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vehicle Dispatch</h1>
          <p className="text-muted-foreground">Manage delivery manifests and dispatch vehicles.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Manifest
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Manifest Code</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Vehicle/Driver</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : dispatchData?.data && dispatchData.data.length > 0 ? (
                  dispatchData.data.map((dispatch) => (
                    <TableRow key={dispatch.id}>
                      <TableCell className="font-medium">{dispatch.manifestCode}</TableCell>
                      <TableCell>{dispatch.campaignName}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{dispatch.vehiclePlate}</span>
                          <span className="text-xs text-muted-foreground">{dispatch.driverName}</span>
                        </div>
                      </TableCell>
                      <TableCell>{dispatch.warehouseName}</TableCell>
                      <TableCell>
                        <Badge variant={dispatch.status === 'Dispatched' ? 'default' : 'secondary'}>
                          {dispatch.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {dispatch.deliveredPackages || 0} / {dispatch.totalPackages || 0}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No dispatch records found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
