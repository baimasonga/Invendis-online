import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListInputItems, getGetDispatchQueryKey } from "@workspace/api-client-react";
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
import { apiAction } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
  dispatchId: number;
}

export function AddManifestItemModal({ open, onClose, dispatchId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inputItemId, setInputItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: inputItems } = useListInputItems();

  function reset() { setInputItemId(""); setQuantity(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputItemId || !quantity) return;
    setSaving(true);
    try {
      await apiAction(`/api/dispatch/${dispatchId}/items`, "POST", {
        inputItemId: Number(inputItemId),
        quantityLoaded: Number(quantity),
      });
      await qc.invalidateQueries({ queryKey: getGetDispatchQueryKey(dispatchId) });
      toast({ title: "Item added to manifest" });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to add item", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Item to Manifest</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Input Item *</Label>
            <Select value={inputItemId} onValueChange={setInputItemId}>
              <SelectTrigger><SelectValue placeholder="Select item…" /></SelectTrigger>
              <SelectContent>
                {(inputItems as any[] ?? []).map((item: any) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    <span>{item.name}</span>
                    <span className="text-muted-foreground text-xs ml-1.5">({item.unit})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ami-qty">Quantity Loaded *</Label>
            <Input
              id="ami-qty"
              type="number"
              min="1"
              step="any"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              placeholder="0"
              required
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={saving || !inputItemId || !quantity}>
              {saving ? "Adding…" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
