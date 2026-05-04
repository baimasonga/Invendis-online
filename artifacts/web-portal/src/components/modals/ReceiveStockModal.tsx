import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useReceiveStock,
  useListWarehouses,
  useListInputItems,
  getGetStockBalanceQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ReceiveStockModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const receiveStock = useReceiveStock();

  const [warehouseId, setWarehouseId] = useState("");
  const [inputItemId, setInputItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const { data: warehouses } = useListWarehouses();
  const { data: inputItems } = useListInputItems();

  function resetForm() {
    setWarehouseId(""); setInputItemId(""); setQuantity(""); setReference(""); setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId || !inputItemId || !quantity) return;
    try {
      await receiveStock.mutateAsync({
        data: {
          warehouseId: Number(warehouseId),
          inputItemId: Number(inputItemId),
          quantity: Number(quantity),
          reference: reference || undefined,
          notes: notes || undefined,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getGetStockBalanceQueryKey() });
      toast({ title: "Stock received", description: `${quantity} units added to warehouse.` });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to receive stock", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive Stock</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Warehouse *</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse…" /></SelectTrigger>
              <SelectContent>
                {(warehouses as any[] ?? []).map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Input Item *</Label>
            <Select value={inputItemId} onValueChange={setInputItemId}>
              <SelectTrigger><SelectValue placeholder="Select item…" /></SelectTrigger>
              <SelectContent>
                {(inputItems as any[] ?? []).map((item: any) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name} <span className="text-muted-foreground">({item.unitOfMeasure ?? item.unit})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rs-qty">Quantity *</Label>
              <Input
                id="rs-qty"
                type="number"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rs-ref">Reference / PO#</Label>
              <Input id="rs-ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="PO-2026-001" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rs-notes">Notes</Label>
            <Input id="rs-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional delivery notes…" />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={receiveStock.isPending}>
              {receiveStock.isPending ? "Saving…" : "Receive Stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
