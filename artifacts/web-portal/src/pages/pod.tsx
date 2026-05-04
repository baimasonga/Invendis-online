import { useState } from "react";
import { useListPod } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProofOfDelivery() {
  const [page, setPage] = useState(1);
  const { data: podData, isLoading } = useListPod({ page });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Proof of Delivery</h1>
        <p className="text-muted-foreground">Monitor delivery verifications and exceptions.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PoD Code</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Input</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
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
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : podData?.data && podData.data.length > 0 ? (
                  podData.data.map((pod) => (
                    <TableRow key={pod.id}>
                      <TableCell className="font-medium">{pod.podCode}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{pod.farmerName}</span>
                          <span className="text-xs text-muted-foreground">{pod.farmerCode}</span>
                        </div>
                      </TableCell>
                      <TableCell>{pod.campaignName}</TableCell>
                      <TableCell>
                        {pod.quantityDelivered}x {pod.inputItemName}
                      </TableCell>
                      <TableCell>
                        <Badge variant={pod.status === 'Verified' ? 'default' : 'destructive'}>
                          {pod.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(pod.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No proof of delivery records found.
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
