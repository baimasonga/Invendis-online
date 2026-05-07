import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createReconciliation, listDispatches, listWarehouses, KEYS } from "@/lib/db";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

const NUM = (v: string) => (v === "" ? 0 : Number(v));

const STATUS_COLOURS: Record<string, string> = {
  "In Transit": "bg-blue-100 text-blue-800",
  "Approved":   "bg-emerald-100 text-emerald-800",
  "Delivered":  "bg-green-100 text-green-800",
  "Completed":  "bg-green-100 text-green-800",
};

export function CreateReconciliationModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({ mutationFn: createReconciliation });

  const [dispatchId, setDispatchId]   = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [loaded, setLoaded]           = useState("");
  const [delivered, setDelivered]     = useState("");
  const [returned, setReturned]       = useState("");
  const [damaged, setDamaged]         = useState("");
  const [notes, setNotes]             = useState("");

  const { data: dispatchesData } = useQuery({
    queryKey: KEYS.dispatches(),
    queryFn: () => listDispatches(1, 200),
  });
  const { data: warehousesData } = useQuery({
    queryKey: KEYS.warehouses(),
    queryFn: listWarehouses,
  });

  // Filter to dispatches that have actually been sent out (not Draft)
  const allDispatches: any[] = (dispatchesData as any)?.data ?? [];
  const dispatchList = allDispatches.filter(
    (d: any) => d.status && d.status !== "Draft"
  );
  const warehouseList: any[] = Array.isArray(warehousesData) ? warehousesData : [];

  const variance = NUM(loaded) - NUM(delivered) - NUM(returned) - NUM(damaged);

  function reset() {
    setDispatchId(""); setWarehouseId(""); setLoaded(""); setDelivered("");
    setReturned(""); setDamaged(""); setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dispatchId || !warehouseId) return;
    try {
      await create.mutateAsync({
        dispatchId:       Number(dispatchId),
        warehouseId:      Number(warehouseId),
        loadedQuantity:   NUM(loaded),
        deliveredQuantity: NUM(delivered),
        returnedQuantity: NUM(returned),
        damagedQuantity:  NUM(damaged),
        notes:            notes || undefined,
        status:           "Draft",
      });
      await qc.invalidateQueries({ queryKey: KEYS.reconciliations() });
      toast({ title: "Reconciliation created" });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create reconciliation", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Stock Reconciliation</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">

            {/* Dispatch selector */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Dispatch Manifest <span className="text-destructive">*</span></Label>
              <Select value={dispatchId} onValueChange={setDispatchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select manifest…" />
                </SelectTrigger>
                <SelectContent>
                  {dispatchList.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No dispatches available</div>
                  ) : (
                    dispatchList.map((d: any) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">{d.manifestCode}</span>
                          {d.status && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOURS[d.status] ?? "bg-gray-100 text-gray-700"}`}>
                              {d.status}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Warehouse selector */}
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Warehouse <span className="text-destructive">*</span></Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse…" />
                </SelectTrigger>
                <SelectContent>
                  {warehouseList.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No warehouses found</div>
                  ) : (
                    warehouseList.map((w: any) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                        {w.code && <span className="ml-1.5 text-xs text-muted-foreground">({w.code})</span>}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Quantity fields */}
            <div className="space-y-1.5">
              <Label>Loaded Qty</Label>
              <Input type="number" min="0" step="any" value={loaded}    onChange={e => setLoaded(e.target.value)}    placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Delivered Qty</Label>
              <Input type="number" min="0" step="any" value={delivered} onChange={e => setDelivered(e.target.value) } placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Returned Qty</Label>
              <Input type="number" min="0" step="any" value={returned}  onChange={e => setReturned(e.target.value) }  placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Damaged Qty</Label>
              <Input type="number" min="0" step="any" value={damaged}   onChange={e => setDamaged(e.target.value) }   placeholder="0" />
            </div>

            {/* Live variance calculation */}
            <div className="col-span-2 flex items-center gap-2 py-2 px-3 rounded-lg bg-muted text-sm">
              <span className="text-muted-foreground">Calculated variance:</span>
              <span className={`font-semibold ml-auto tabular-nums ${
                variance < 0 ? "text-red-700" : variance > 0 ? "text-blue-700" : "text-muted-foreground"
              }`}>
                {variance > 0 ? `+${variance}` : variance}
              </span>
              {variance !== 0 && (
                <Badge variant="outline" className={`text-[10px] px-1.5 ${variance < 0 ? "border-red-300 text-red-700" : "border-blue-300 text-blue-700"}`}>
                  {variance < 0 ? "Shortfall" : "Surplus"}
                </Badge>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5 col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any observations or exceptions…"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={create.isPending || !dispatchId || !warehouseId}
            >
              {create.isPending ? "Saving…" : "Create Reconciliation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
