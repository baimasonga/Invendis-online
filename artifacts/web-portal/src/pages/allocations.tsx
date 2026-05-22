import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listAllocations, removeAllocation, updateAllocation, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Users, ChevronLeft, ChevronRight, Pencil, Trash2, UsersRound } from "lucide-react";
import { NewAllocationModal } from "@/components/modals/NewAllocationModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";

function EditAllocationModal({ open, allocation, onClose }: { open: boolean; allocation: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [notes, setNotes] = useState(allocation?.notes ?? "");
  const [status, setStatus] = useState(allocation?.status ?? "Pending");

  const updateMut = useMutation({ mutationFn: (payload: { notes?: string; status?: string }) => updateAllocation(allocation?.id, payload) });

  function handleOpen() {
    setNotes(allocation?.notes ?? "");
    setStatus(allocation?.status ?? "Pending");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({ notes: notes || undefined, status });
      await qc.invalidateQueries({ queryKey: KEYS.allocations() });
      toast({ title: "Allocation updated" });
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }} >
      <DialogContent className="sm:max-w-sm" onAnimationStart={handleOpen}>
        <DialogHeader><DialogTitle>Edit Allocation</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Pending", "Delivered", "Cancelled"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMut.isPending}>
              {updateMut.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Allocations() {
  const can = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const limit = 20;

  const { data: allocationsData, isLoading } = useQuery({
    queryKey: KEYS.allocations(page),
    queryFn: () => listAllocations(page, limit),
  });
  const rows: any[]   = allocationsData?.data ?? [];
  const total: number = allocationsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const deleteMutation = useMutation({ mutationFn: (id: number) => removeAllocation(id) });

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.allocations() });
      toast({ title: "Allocation removed" });
    } catch (err: any) {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Allocations"
        subtitle="Farmer allocations across all campaigns."
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Allocation
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && <p className="text-xs text-muted-foreground">{total.toLocaleString()} allocations</p>}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4">Farmer</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="hidden md:table-cell">Notes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                {can.manageAllocations && <TableHead className="pr-4 text-right w-[100px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      {can.manageAllocations && <TableCell className="pr-4" />}
                    </TableRow>
                  ))
                : rows.length > 0
                ? rows.map((a: any) => (
                    <TableRow key={a.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium">{a.farmerName ?? "—"}</p>
                            {a.beneficiaryType === "group" && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 shrink-0">
                                <UsersRound className="h-2.5 w-2.5" />
                                Group{a.groupSize ? ` · ${a.groupSize}` : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono">{a.farmerCode ?? ""}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/campaigns/${a.campaignId}`}>
                          <span className="text-sm text-green-700 hover:underline cursor-pointer">{a.campaignName ?? "—"}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.notes ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={a.status ?? "Pending"} /></TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                      {can.manageAllocations && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                              onClick={() => setEditTarget(a)}
                            >
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                              onClick={() => setDeleteTarget(a)}
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
                      <TableCell colSpan={can.manageAllocations ? 6 : 5} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Users className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No allocations found</span>
                          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first allocation
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

      <NewAllocationModal open={open} onClose={() => setOpen(false)} />
      <EditAllocationModal open={!!editTarget} allocation={editTarget} onClose={() => setEditTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {deleteTarget?.farmerName ?? "this farmer"}'s allocation from{" "}
              <span className="font-medium">{deleteTarget?.campaignName}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
