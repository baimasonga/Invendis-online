import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { listDispatches, approveDispatch, dispatchManifest, arriveDispatch, deleteDispatch, cancelDispatch, assignDispatchOfficer, listFieldOfficers, archiveDispatch, unarchiveDispatch, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, ChevronLeft, ChevronRight, Package2, Truck, MapPin, Car, Trash2, XCircle, UserCheck, Search, X, Archive, ArchiveRestore } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CreateManifestModal } from "@/components/modals/CreateManifestModal";
import { ImportManifestModal } from "@/components/modals/ImportManifestModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
  const can = usePermissions();
  const [page, setPage] = useState(1);
  const [officerFilter, setOfficerFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [manifestSearch, setManifestSearch] = useState("");
  const [debouncedManifestSearch, setDebouncedManifestSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedManifestSearch(manifestSearch);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [manifestSearch]);

  const limit = 20;
  const officerIdNum = officerFilter !== "all" ? Number(officerFilter) : undefined;
  const { data: dispatchData, isLoading } = useQuery({
    queryKey: KEYS.dispatches(page, officerIdNum, statusFilter, debouncedManifestSearch, showArchived),
    queryFn: () => listDispatches(page, limit, officerIdNum, statusFilter, debouncedManifestSearch, showArchived),
  });

  const { data: officersList = [] } = useQuery({
    queryKey: KEYS.fieldOfficers(),
    queryFn: listFieldOfficers,
  });
  const total = dispatchData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const approveMutation  = useMutation({ mutationFn: (id: number) => approveDispatch(id) });
  const dispatchMutation = useMutation({ mutationFn: (id: number) => dispatchManifest(id) });
  const arriveMutation   = useMutation({ mutationFn: (id: number) => arriveDispatch(id) });
  const deleteMutation   = useMutation({ mutationFn: (id: number) => deleteDispatch(id) });
  const cancelMutation   = useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelDispatch(id, reason) });
  const archiveMutation  = useMutation({ mutationFn: (id: number) => archiveDispatch(id) });
  const unarchiveMutation = useMutation({ mutationFn: (id: number) => unarchiveDispatch(id) });

  async function handleApprove(id: number) {
    setLoadingId(id);
    try {
      await approveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: "Manifest approved" });
    } catch (err: any) {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleDispatch(id: number) {
    setLoadingId(id);
    try {
      await dispatchMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: "Vehicle dispatched", description: "Manifest marked as Dispatched." });
    } catch (err: any) {
      toast({ title: "Failed to dispatch", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleArrive(id: number) {
    setLoadingId(id);
    try {
      await arriveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: "Arrival confirmed", description: "Manifest marked as Arrived." });
    } catch (err: any) {
      toast({ title: "Failed to mark arrival", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: "Manifest deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally { setDeleteTarget(null); }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync({ id: cancelTarget.id, reason: cancelReason });
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: "Manifest cancelled", description: cancelTarget.manifestCode });
    } catch (err: any) {
      toast({ title: "Failed to cancel", description: err.message, variant: "destructive" });
    } finally { setCancelTarget(null); setCancelReason(""); }
  }

  async function handleArchive(id: number, doArchive: boolean) {
    setLoadingId(id);
    try {
      if (doArchive) await archiveMutation.mutateAsync(id);
      else await unarchiveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      toast({ title: doArchive ? "Manifest archived" : "Manifest restored from archive" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicle Dispatch"
        subtitle="Manage delivery manifests and track dispatch status."
        actions={
          <div className="flex gap-2">
            {can.manageDispatch && (
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Import from Excel
              </Button>
            )}
            <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create Manifest
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="h-8 pl-8 pr-7 text-xs"
                  placeholder="Search manifest code…"
                  value={manifestSearch}
                  onChange={(e) => setManifestSearch(e.target.value)}
                />
                {manifestSearch && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setManifestSearch("")}
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {!isLoading && <p className="text-xs text-muted-foreground ml-1">{total.toLocaleString()} manifests</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant={showArchived ? "secondary" : "outline"}
                className="h-8 text-xs"
                onClick={() => { setShowArchived(v => !v); setPage(1); }}
              >
                {showArchived
                  ? <><ArchiveRestore className="h-3.5 w-3.5 mr-1.5" />Show Active</>
                  : <><Archive className="h-3.5 w-3.5 mr-1.5" />Show Archived</>}
              </Button>
              <span className="text-xs text-muted-foreground whitespace-nowrap">Status</span>
              <Select
                value={statusFilter}
                onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Dispatched">Dispatched</SelectItem>
                  <SelectItem value="In Transit">In Transit</SelectItem>
                  <SelectItem value="Arrived">Arrived</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground whitespace-nowrap">Field Officer</span>
              <Select
                value={officerFilter}
                onValueChange={(v) => { setOfficerFilter(v); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-48 text-xs">
                  <SelectValue placeholder="All officers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All officers</SelectItem>
                  {(officersList as any[]).map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[130px]">Manifest</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="hidden md:table-cell">Vehicle / Driver</TableHead>
                <TableHead className="hidden lg:table-cell">Warehouse</TableHead>
                <TableHead className="hidden xl:table-cell">Officer</TableHead>
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
                      <TableCell className="hidden xl:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : dispatchData?.data && dispatchData.data.length > 0
                ? dispatchData.data.map((d: any) => {
                    const status = d.status?.toLowerCase().replace(/\s+/g, "");
                    const busy = loadingId === d.id;
                    const isDraft = status === "draft" || status === "pending";
                    return (
                      <TableRow key={d.id} className={`hover:bg-muted/40 ${d.archived ? "opacity-60" : ""}`}>
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
                        <TableCell className="hidden xl:table-cell">
                          {d.fieldOfficerName
                            ? <span className="flex items-center gap-1 text-sm"><UserCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />{d.fieldOfficerName}</span>
                            : <span className="text-xs text-muted-foreground">Unassigned</span>}
                        </TableCell>
                        <TableCell><StatusBadge status={d.status} /></TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <DeliveryProgress delivered={d.deliveredPackages ?? 0} total={d.totalPackages ?? 0} />
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isDraft && (
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
                            {isDraft && can.manageDispatch && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-1.5 text-red-500 hover:text-red-700 hover:bg-red-50"
                                disabled={busy}
                                onClick={() => setDeleteTarget(d)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {(status === "approved" || status === "dispatched" || status === "intransit") && can.manageDispatch && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-1.5 text-orange-600 hover:text-orange-800 hover:bg-orange-50"
                                disabled={busy}
                                onClick={() => { setCancelReason(""); setCancelTarget(d); }}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {(status === "completed" || status === "cancelled") && can.manageDispatch && !d.archived && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                                disabled={busy}
                                title="Archive this manifest"
                                onClick={() => handleArchive(d.id, true)}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {d.archived && can.manageDispatch && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 px-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                disabled={busy}
                                title="Restore from archive"
                                onClick={() => handleArchive(d.id, false)}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                : (
                    <TableRow>
                      <TableCell colSpan={8} className="h-32 text-center">
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

      <Dialog open={!!cancelTarget} onOpenChange={(v) => { if (!v) { setCancelTarget(null); setCancelReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel manifest {cancelTarget?.manifestCode}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              This will set the manifest status to <span className="font-semibold text-red-700">Cancelled</span>.
              Field officers will no longer be able to record deliveries against it.
            </p>
            <Textarea
              placeholder="Reason for cancellation (optional)…"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelTarget(null); setCancelReason(""); }}>Back</Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              disabled={cancelMutation.isPending}
              onClick={handleCancel}
            >
              {cancelMutation.isPending ? "Cancelling…" : "Cancel Manifest"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete manifest?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete manifest{" "}
              <span className="font-mono font-medium">{deleteTarget?.manifestCode}</span>. All items associated with this manifest will also be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateManifestModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportManifestModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
