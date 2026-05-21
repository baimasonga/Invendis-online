import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listProcurementOrders, deleteProcurementOrder, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ShoppingCart, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateProcurementOrderModal } from "@/components/modals/CreateProcurementOrderModal";
import { EditProcurementOrderModal } from "@/components/modals/EditProcurementOrderModal";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";

export default function Procurement() {
  const can = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: KEYS.procurement(),
    queryFn: listProcurementOrders,
  });
  const orderList: any[] = Array.isArray(orders) ? orders : [];

  const deleteMutation = useMutation({ mutationFn: (id: number) => deleteProcurementOrder(id) });

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.procurement() });
      toast({ title: "Order deleted" });
    } catch (err: any) {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  }

  const editableStatuses = ["Draft", "Pending"];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Procurement"
        subtitle="Manage incoming stock orders from suppliers."
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Order
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && <p className="text-xs text-muted-foreground">{orderList.length} orders</p>}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[130px]">Order Code</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                <TableHead className="hidden lg:table-cell">Order Date</TableHead>
                <TableHead className="hidden lg:table-cell">Expected</TableHead>
                <TableHead>Status</TableHead>
                {can.manageProcurement && <TableHead className="pr-4 text-right w-[110px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      {can.manageProcurement && <TableCell className="pr-4" />}
                    </TableRow>
                  ))
                : orderList.length > 0
                ? orderList.map((o: any) => {
                    const canEdit = can.manageProcurement && editableStatuses.includes(o.status);
                    return (
                      <TableRow key={o.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{o.orderCode}</TableCell>
                        <TableCell className="text-sm font-medium">{o.supplierName ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{o.warehouseName ?? "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {o.orderDate ? new Date(o.orderDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {o.expectedDelivery ? new Date(o.expectedDelivery).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                        </TableCell>
                        <TableCell><StatusBadge status={o.status} /></TableCell>
                        {can.manageProcurement && (
                          <TableCell className="pr-4 text-right">
                            {canEdit && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                                  onClick={() => setEditTarget(o)}
                                >
                                  <Pencil className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 px-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                                  onClick={() => setDeleteTarget(o)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                : (
                    <TableRow>
                      <TableCell colSpan={can.manageProcurement ? 7 : 6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ShoppingCart className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No procurement orders yet</span>
                          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first order
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateProcurementOrderModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditProcurementOrderModal open={!!editTarget} order={editTarget} onClose={() => setEditTarget(null)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete order{" "}
              <span className="font-mono font-medium">{deleteTarget?.orderCode}</span> from{" "}
              <span className="font-medium">{deleteTarget?.supplierName}</span>. This cannot be undone.
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
    </div>
  );
}
