import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSubmitPod,
  useListFarmers,
  useListDispatches,
  useListInputItems,
  getListPodQueryKey,
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
  prefilledDispatchId?: number;
}

export function SubmitPodModal({ open, onClose, prefilledDispatchId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const submitPod = useSubmitPod();

  const [farmerId, setFarmerId] = useState("");
  const [dispatchId, setDispatchId] = useState(prefilledDispatchId ? String(prefilledDispatchId) : "");
  const [inputItemId, setInputItemId] = useState("");
  const [quantityDelivered, setQuantityDelivered] = useState("");
  const [notes, setNotes] = useState("");
  const [farmerSearch, setFarmerSearch] = useState("");

  const { data: farmersData } = useListFarmers({ limit: 200 } as any);
  const { data: dispatchesData } = useListDispatches({ limit: 100 } as any);
  const { data: inputItems } = useListInputItems();

  const farmers = (farmersData as any)?.data ?? [];
  const dispatches = (dispatchesData as any)?.data ?? [];

  const filteredFarmers = farmerSearch
    ? farmers.filter((f: any) =>
        `${f.firstName} ${f.lastName} ${f.farmerCode}`.toLowerCase().includes(farmerSearch.toLowerCase())
      )
    : farmers;

  function reset() {
    setFarmerId(""); setInputItemId(""); setQuantityDelivered(""); setNotes(""); setFarmerSearch("");
    if (!prefilledDispatchId) setDispatchId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!farmerId || !quantityDelivered) return;

    const selectedDispatch = dispatches.find((d: any) => String(d.id) === dispatchId);

    try {
      await submitPod.mutateAsync({
        data: {
          farmerId: Number(farmerId),
          dispatchId: dispatchId ? Number(dispatchId) : undefined,
          campaignId: selectedDispatch?.campaignId ?? undefined,
          inputItemId: inputItemId ? Number(inputItemId) : undefined,
          quantityDelivered: Number(quantityDelivered),
          notes: notes || undefined,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListPodQueryKey() });
      toast({ title: "Delivery recorded", description: "PoD submitted as Pending verification." });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to submit PoD", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Delivery</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Dispatch selection */}
          {!prefilledDispatchId && (
            <div className="space-y-1.5">
              <Label>Dispatch Manifest</Label>
              <Select value={dispatchId} onValueChange={setDispatchId}>
                <SelectTrigger><SelectValue placeholder="Select manifest…" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {dispatches.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      <span className="font-mono text-xs">{d.manifestCode}</span>
                      <span className="text-muted-foreground ml-1.5">— {d.campaignName ?? "No campaign"}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Farmer */}
          <div className="space-y-1.5">
            <Label htmlFor="sp-fsearch">Farmer *</Label>
            <Input
              id="sp-fsearch"
              placeholder="Search by name or code…"
              value={farmerSearch}
              onChange={e => setFarmerSearch(e.target.value)}
              className="mb-1"
            />
            <Select value={farmerId} onValueChange={setFarmerId}>
              <SelectTrigger><SelectValue placeholder="Select farmer…" /></SelectTrigger>
              <SelectContent className="max-h-52">
                {filteredFarmers.slice(0, 50).map((f: any) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    <span>{f.firstName} {f.lastName}</span>
                    <span className="text-muted-foreground text-xs ml-1.5">{f.farmerCode}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Input item */}
          <div className="space-y-1.5">
            <Label>Input Item</Label>
            <Select value={inputItemId} onValueChange={setInputItemId}>
              <SelectTrigger><SelectValue placeholder="Select item…" /></SelectTrigger>
              <SelectContent>
                {(inputItems as any[] ?? []).map((item: any) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                    {(item.unit ?? item.unitOfMeasure) && (
                      <span className="text-muted-foreground ml-1.5 text-xs">({item.unit ?? item.unitOfMeasure})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sp-qty">Qty Delivered *</Label>
              <Input
                id="sp-qty"
                type="number"
                min="1"
                value={quantityDelivered}
                onChange={e => setQuantityDelivered(e.target.value)}
                placeholder="0"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-notes">Notes</Label>
              <Input id="sp-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={submitPod.isPending || !farmerId || !quantityDelivered}>
              {submitPod.isPending ? "Submitting…" : "Record Delivery"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
