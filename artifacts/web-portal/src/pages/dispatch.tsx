import { useState } from "react";
import { useListDispatches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight, Package2 } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
  approved:   "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
  dispatched: "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  intransit:  "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  arrived:    "bg-teal-100   text-teal-800   dark:bg-teal-900/30    dark:text-teal-400",
  completed:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  cancelled:  "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase().replace(/\s+/g, "")] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function DeliveryProgress({ delivered, total }: { delivered: number; total: number }) {
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.round((delivered / total) * 100));
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">{delivered}/{total}</span>
    </div>
  );
}

export default function Dispatch() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data: dispatchData, isLoading } = useListDispatches({ page });
  const total = dispatchData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Vehicle Dispatch</h1>
          <p className="text-sm text-muted-foreground">Manage delivery manifests and track dispatch status.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create Manifest
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && <p className="text-xs text-muted-foreground">{total.toLocaleString()} manifests</p>}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[130px]">Manifest</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="hidden md:table-cell">Vehicle / Driver</TableHead>
                <TableHead className="hidden lg:table-cell">Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Delivery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : dispatchData?.data && dispatchData.data.length > 0
                ? dispatchData.data.map((d) => (
                    <TableRow key={d.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{d.manifestCode}</TableCell>
                      <TableCell className="text-sm font-medium">{d.campaignName ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div>
                          <p className="text-sm font-medium">{d.vehiclePlate ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">{d.driverName ?? "Unassigned"}</p>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{d.warehouseName ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={d.status} /></TableCell>
                      <TableCell className="pr-4">
                        <DeliveryProgress delivered={d.deliveredPackages ?? 0} total={d.totalPackages ?? 0} />
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Package2 className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No dispatch records found</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>

          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
