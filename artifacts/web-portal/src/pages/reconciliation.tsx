import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listReconciliations, approveReconciliation, rejectReconciliation, KEYS } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCcw, TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CreateReconciliationModal } from "@/components/modals/CreateReconciliationModal";

const STATUS_STYLES: Record<string, string> = {
  pending:  "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
  draft:    "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function Variance({ value }: { value: number }) {
  if (value === 0) {
    return <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Minus className="h-3.5 w-3.5" /> 0</span>;
  }
  if (value > 0) {
    return <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 dark:text-blue-400"><TrendingUp className="h-3.5 w-3.5" />+{value}</span>;
  }
  return <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-700 dark:text-red-400"><TrendingDown className="h-3.5 w-3.5" />{value}</span>;
}

export default function Reconciliation() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: KEYS.reconciliations(),
    queryFn: listReconciliations,
  });

  const approveMutation = useMutation({ mutationFn: (id: number) => approveReconciliation(id) });
  const rejectMutation  = useMutation({ mutationFn: (id: number) => rejectReconciliation(id) });

  async function handleApprove(id: number) {
    setLoadingId(id);
    try {
      await approveMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.reconciliations() });
      toast({ title: "Reconciliation approved" });
    } catch (err: any) {
      toast({ title: "Failed to approve", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  async function handleReject(id: number) {
    setLoadingId(id);
    try {
      await rejectMutation.mutateAsync(id);
      await qc.invalidateQueries({ queryKey: KEYS.reconciliations() });
      toast({ title: "Reconciliation rejected" });
    } catch (err: any) {
      toast({ title: "Failed to reject", description: err.message, variant: "destructive" });
    } finally { setLoadingId(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Stock Reconciliation</h1>
          <p className="text-sm text-muted-foreground">Post-dispatch stock reconciliation and variance analysis.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Reconciliation
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[130px]">Code</TableHead>
                <TableHead className="hidden md:table-cell">Manifest</TableHead>
                <TableHead className="text-right hidden md:table-cell">Loaded</TableHead>
                <TableHead className="text-right hidden md:table-cell">Delivered</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Returned</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-24 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : (records as any[]).length > 0
                ? (records as any[]).map((r: any) => {
                    const status = r.status?.toLowerCase();
                    const busy = loadingId === r.id;
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{r.reconciliationCode}</TableCell>
                        <TableCell className="hidden md:table-cell font-medium text-sm">{r.manifestCode ?? `Dispatch #${r.dispatchId}`}</TableCell>
                        <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{r.loadedQuantity ?? 0}</TableCell>
                        <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{r.deliveredQuantity ?? 0}</TableCell>
                        <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums">{r.returnedQuantity ?? 0}</TableCell>
                        <TableCell className="text-right"><Variance value={r.varianceQuantity ?? 0} /></TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {(status === "draft" || status === "pending") && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                                  disabled={busy}
                                  onClick={() => handleApprove(r.id)}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                                  disabled={busy}
                                  onClick={() => handleReject(r.id)}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </>
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
                          <RefreshCcw className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No reconciliation records</span>
                          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first reconciliation
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateReconciliationModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
