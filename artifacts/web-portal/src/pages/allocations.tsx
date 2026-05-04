import { useState } from "react";
import { useListAllocations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Allocations() {
  const [page, setPage] = useState(1);
  const { data: allocationsData, isLoading } = useListAllocations({ page });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Allocations</h1>
          <p className="text-muted-foreground">Manage farmer input allocations across campaigns.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Allocation
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Input Item</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : allocationsData?.data && allocationsData.data.length > 0 ? (
                  allocationsData.data.map((allocation) => (
                    <TableRow key={allocation.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{allocation.farmerName}</span>
                          <span className="text-xs text-muted-foreground">{allocation.farmerCode}</span>
                        </div>
                      </TableCell>
                      <TableCell>{allocation.campaignName}</TableCell>
                      <TableCell>{allocation.inputItemName}</TableCell>
                      <TableCell>{allocation.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={allocation.status === 'Delivered' ? 'default' : 'secondary'}>
                          {allocation.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(allocation.createdAt).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No allocations found.
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
