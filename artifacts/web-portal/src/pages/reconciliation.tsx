import { useState } from "react";
import { useListReconciliations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Reconciliation() {
  const [page, setPage] = useState(1);
  const { data: recordsData, isLoading } = useListReconciliations({});

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Reconciliation</h1>
          <p className="text-muted-foreground">Manage and review post-dispatch stock reconciliations.</p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Reconciliation
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Loaded</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    </TableRow>
                  ))
                ) : recordsData && Array.isArray(recordsData) && recordsData.length > 0 ? (
                  (recordsData as any[]).map((record: any) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">{record.reconciliationCode}</TableCell>
                      <TableCell>{record.campaignName}</TableCell>
                      <TableCell className="text-right">{record.totalLoaded}</TableCell>
                      <TableCell className="text-right">{record.totalDelivered}</TableCell>
                      <TableCell className="text-right">{record.totalReturned}</TableCell>
                      <TableCell className="text-right">
                        <span className={record.variance < 0 ? "text-destructive font-medium" : record.variance > 0 ? "text-primary font-medium" : ""}>
                          {record.variance > 0 ? '+' : ''}{record.variance}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          record.status === 'Approved' ? 'default' : 
                          record.status === 'Rejected' ? 'destructive' : 'secondary'
                        }>
                          {record.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No reconciliation records found.
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
