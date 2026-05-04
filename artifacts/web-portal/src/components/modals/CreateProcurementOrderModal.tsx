import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateProcurementOrder,
  useListWarehouses,
  useListInputItems,
  getListProcurementOrdersQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

export function CreateProcurementOrderModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProcurementOrder();

  const [supplier, setSupplier]   = useState("");
  const [warehouseId, setWh]      = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [expected, setExpected]   = useState("");
  const [notes, setNotes]         = useState("");

  const { data: warehouses } = useListWarehouses();
  const warehouseList: any[] = (warehouses as any[]) ?? [];

  function reset() { setSupplier(""); setWh(""); setOrderDate(""); setExpected(""); setNotes(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplier || !warehouseId) return;
    try {
      await create.mutateAsync({
        data: {
          supplierName: supplier,
          warehouseId: Number(warehouseId),
          orderDate: orderDate ? new Date(orderDate).toISOString() : new Date().toISOString(),
          expectedDelivery: expected ? new Date(expected).toISOString() : undefined,
          notes: notes || undefined,
          status: "Draft",
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListProcurementOrdersQueryKey() });
      toast({ title: "Procurement order created" });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create Procurement Order</DialogTitle></DialogHeader>
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
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional details…" rows={2} />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !supplier || !warehouseId}>
              {create.isPending ? "Creating…" : "Create Order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
