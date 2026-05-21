import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { updateProcurementOrder, listWarehouses, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; order: any | null; onClose: () => void; }

export function EditProcurementOrderModal({ open, order, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useMutation({ mutationFn: (payload: any) => updateProcurementOrder(order?.id, payload) });

  const [supplier, setSupplier]   = useState("");
  const [warehouseId, setWh]      = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expected, setExpected]   = useState("");
  const [status, setStatus]       = useState("Draft");
  const [notes, setNotes]         = useState("");

  const { data: warehouses } = useQuery({ queryKey: KEYS.warehouses(), queryFn: listWarehouses });
  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];

  useEffect(() => {
    if (order) {
      setSupplier(order.supplierName ?? "");
      setWh(order.warehouseId ? String(order.warehouseId) : "");
      setOrderDate(order.orderDate ? new Date(order.orderDate).toISOString().slice(0, 10) : "");
      setExpected(order.expectedDelivery ? new Date(order.expectedDelivery).toISOString().slice(0, 10) : "");
      setStatus(order.status ?? "Draft");
      setNotes(order.notes ?? "");
    }
  }, [order]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier || !warehouseId) return;
    try {
      await update.mutateAsync({
        supplierName: supplier,
        warehouseId: Number(warehouseId),
        orderDate: orderDate || undefined,
        expectedDelivery: expected || undefined,
        notes: notes || undefined,
        status,
      });
      await qc.invalidateQueries({ queryKey: KEYS.procurement() });
      toast({ title: "Order updated" });
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Procurement Order</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Supplier Name *</Label>
            <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="AgriSupply Co." required />
          </div>
          <div className="space-y-1.5">
            <Label>Destination Warehouse *</Label>
            <Select value={warehouseId} onValueChange={setWh}>
              <SelectTrigger><SelectValue placeholder="Select warehouse…" /></SelectTrigger>
              <SelectContent>
                {warehouseList.map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Order Date</Label>
              <Input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Expected Delivery</Label>
              <Input type="date" value={expected} onChange={e => setExpected(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Draft", "Pending", "Received", "Cancelled"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional details…" rows={2} />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={update.isPending || !supplier || !warehouseId}>
              {update.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
