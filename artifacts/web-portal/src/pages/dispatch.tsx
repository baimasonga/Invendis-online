import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { listDispatches, approveDispatch, dispatchManifest, arriveDispatch, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight, Package2, Truck, MapPin, Car } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CreateManifestModal } from "@/components/modals/CreateManifestModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";

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
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const limit = 20;
  const { data: dispatchData, isLoading } = useQuery({
    queryKey: KEYS.dispatches(page),
    queryFn: () => listDispatches(page, limit),
  });
  const total = dispatchData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const approveMutation  = useMutation({ mutationFn: (id: number) => approveDispatch(id) });
  const dispatchMutation = useMutation({ mutationFn: (id: number) => dispatchManifest(id) });
  const arriveMutation   = useMutation({ mutationFn: (id: number) => arriveDispatch(id) });

  async function handleApprove(id: number) {
    setLoadingId(id);
    try {
      await approveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.dispatches() });
      toast({ title: "Manifest approved" });
    } catch (err: any) {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleDispatch(id: number) {
    setLoadingId(id);
    try {
      await dispatchMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.dispatches() });
      toast({ title: "Vehicle dispatched", description: "Manifest marked as Dispatched." });
    } catch (err: any) {
      toast({ title: "Failed to dispatch", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleArrive(id: number) {
    setLoadingId(id);
    try {
      await arriveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.dispatches() });
      toast({ title: "Arrival confirmed", description: "Manifest marked as Arrived." });
    } catch (err: any) {
      toast({ title: "Failed to mark arrival", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicle Dispatch"
        subtitle="Manage delivery manifests and track dispatch status."
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Manifest
          </Button>
        }
      />

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
                <TableHead className="hidden sm:table-cell text-right">Delivery</TableHead>
                <TableHead className="pr-4 text-right">Action</TableHead>
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
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : dispatchData?.data && dispatchData.data.length > 0
                ? dispatchData.data.map((d) => {
                    const status = d.status?.toLowerCase().replace(/\s+/g, "");
                    const busy = loadingId === d.id;
                    return (
                      <TableRow key={d.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4">
                          <Link href={`/dispatch/${d.id}`}>
                            <span className="font-mono text-xs text-green-700 hover:text-green-900 hover:underline cursor-pointer">
                              {d.manifestCode}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{d.campaignName ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div>
                            <div className="flex items-center gap-1.5">
                              {d.isHired
                                ? <Truck className="h-3 w-3 text-amber-600 shrink-0" />
                                : <Car className="h-3 w-3 text-muted-foreground shrink-0" />}
                              <p className="text-sm font-medium">{d.plateNumber ?? "—"}</p>
                              {d.isHired && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Hired</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground ml-4.5">{d.driverName ?? "Unassigned"}</p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{d.warehouseName ?? "—"}</TableCell>
                        <TableCell><StatusBadge status={d.status} /></TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <DeliveryProgress delivered={d.deliveredPackages ?? 0} total={d.totalPackages ?? 0} />
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {status === "pending" && (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => handleApprove(d.id)}>
                                Approve
                              </Button>
                            )}
                            {status === "approved" && (
                              <Button size="sm" className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={busy} onClick={() => handleDispatch(d.id)}>
                                <Truck className="h-3 w-3 mr-1" />
                                Dispatch
                              </Button>
                            )}
                            {(status === "dispatched" || status === "intransit") && (
                              <Button size="sm" className="h-7 px-2 text-xs bg-teal-600 hover:bg-teal-700 text-white" disabled={busy} onClick={() => handleArrive(d.id)}>
                                <MapPin className="h-3 w-3 mr-1" />
                                Arrived
                              </Button>
                            )}
                            <Link href={`/dispatch/${d.id}`}>
                              <span className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer ml-1">
                                View
                              </span>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Package2 className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No dispatch records yet</span>
                          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first manifest
                          </Button>
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

      <CreateManifestModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
