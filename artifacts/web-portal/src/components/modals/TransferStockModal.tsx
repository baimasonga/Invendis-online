import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { transferStock, listWarehouses, listInputItems, KEYS } from "@/lib/db";
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
import { ArrowRight } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TransferStockModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const transfer = useMutation({ mutationFn: transferStock });

  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId]     = useState("");
  const [inputItemId, setInputItemId]         = useState("");
  const [quantity, setQuantity]               = useState("");
  const [notes, setNotes]                     = useState("");

  const { data: warehouses } = useQuery({ queryKey: KEYS.warehouses(), queryFn: listWarehouses });
  const { data: inputItems } = useQuery({ queryKey: KEYS.inventory(),  queryFn: listInputItems });

  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];
  const itemList: any[]      = Array.isArray(inputItems)  ? inputItems.filter((i: any) => i.isActive !== false) : [];

  function resetForm() {
    setFromWarehouseId(""); setToWarehouseId(""); setInputItemId("");
    setQuantity(""); setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromWarehouseId || !toWarehouseId || !inputItemId || !quantity) return;
    if (fromWarehouseId === toWarehouseId) {
      toast({ title: "Invalid transfer", description: "Source and destination warehouses must be different.", variant: "destructive" });
      return;
    }
    try {
      await transfer.mutateAsync({
        fromWarehouseId: Number(fromWarehouseId),
        toWarehouseId:   Number(toWarehouseId),
        inputItemId:     Number(inputItemId),
        quantity:        Number(quantity),
        notes:           notes || undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.stockBalance() });
      toast({ title: "Stock transferred", description: `${quantity} units moved between warehouses.` });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Stock</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">

          {/* ── Warehouse row ── */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label>From Warehouse *</Label>
              <Select value={fromWarehouseId} onValueChange={setFromWarehouseId}>
                <SelectTrigger className={fromWarehouseId && fromWarehouseId === toWarehouseId ? "border-red-400" : ""}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseList.map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="pb-2 text-muted-foreground"><ArrowRight className="h-4 w-4" /></div>
            <div className="space-y-1.5">
              <Label>To Warehouse *</Label>
              <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
                <SelectTrigger className={fromWarehouseId && fromWarehouseId === toWarehouseId ? "border-red-400" : ""}>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseList.map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {fromWarehouseId && fromWarehouseId === toWarehouseId && (
            <p className="text-xs text-red-500 -mt-2">Source and destination must be different.</p>
          )}

          {/* ── Input item ── */}
          <div className="space-y-1.5">
            <Label>Input Item *</Label>
            <Select value={inputItemId} onValueChange={setInputItemId}>
              <SelectTrigger><SelectValue placeholder="Select item…" /></SelectTrigger>
              <SelectContent>
                {itemList.map((item: any) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}{" "}
                    <span className="text-muted-foreground">({item.itemCode ?? item.unit})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ts-qty">Quantity *</Label>
              <Input
                id="ts-qty"
                type="number"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ts-notes">Notes</Label>
              <Input
                id="ts-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional…"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button
              type="submit"
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={transfer.isPending || !fromWarehouseId || !toWarehouseId || !inputItemId || !quantity || fromWarehouseId === toWarehouseId}
            >
              {transfer.isPending ? "Transferring…" : "Transfer Stock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
