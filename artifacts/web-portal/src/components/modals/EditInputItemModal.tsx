import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { updateInputItem, listValueChains, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["Seed", "Fertilizer", "Chemical", "Tool", "Equipment", "Other"];

interface Props {
  open: boolean;
  onClose: () => void;
  item: any;
}

export function EditInputItemModal({ open, onClose, item }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateInputItem(id, payload) });

  const [name, setName]               = useState("");
  const [category, setCategory]       = useState("");
  const [unit, setUnit]               = useState("");
  const [valueChainId, setValueChainId] = useState("");

  useEffect(() => {
    if (item && open) {
      setName(item.name ?? "");
      setCategory(item.category ?? "");
      setUnit(item.unit ?? item.unitOfMeasure ?? "");
      setValueChainId(item.valueChainId ? String(item.valueChainId) : "");
    }
  }, [item, open]);

  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        payload: {
          name,
          category: category || undefined,
          unit: unit || undefined,
          valueChainId: valueChainId && valueChainId !== "0" ? Number(valueChainId) : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.inventory() });
      toast({ title: "Item updated", description: `"${name}" updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Edit Input Item</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, bags, litres…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Value Chain</Label>
            <Select value={valueChainId} onValueChange={setValueChainId}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">— None —</SelectItem>
                {valueChainList.map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMutation.isPending || !name}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
