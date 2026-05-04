import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAllocation,
  useListFarmers,
  getListAllocationsQueryKey,
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
  campaignId: number;
}

export function AddAllocationModal({ open, onClose, campaignId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createAllocation = useCreateAllocation();
  const [farmerId, setFarmerId] = useState("");
  const [search, setSearch] = useState("");

  const { data: farmersData } = useListFarmers({ limit: 100, status: "approved" } as any);
  const farmers = (farmersData as any)?.data ?? [];
  const filtered = search
    ? farmers.filter((f: any) =>
        `${f.firstName} ${f.lastName} ${f.farmerCode}`.toLowerCase().includes(search.toLowerCase())
      )
    : farmers;

  function reset() { setFarmerId(""); setSearch(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!farmerId) return;
    try {
      await createAllocation.mutateAsync({ data: { campaignId, farmerId: Number(farmerId) } as any });
      await qc.invalidateQueries({ queryKey: getListAllocationsQueryKey({ campaignId } as any) });
      toast({ title: "Farmer allocated to campaign" });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to allocate", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Farmer to Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="aa-search">Search Farmer</Label>
            <Input
              id="aa-search"
              placeholder="Name or farmer code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Farmer *</Label>
            <Select value={farmerId} onValueChange={setFarmerId}>
              <SelectTrigger><SelectValue placeholder="Select farmer…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {filtered.length === 0
                  ? <div className="py-6 text-center text-sm text-muted-foreground">No approved farmers found</div>
                  : filtered.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <span className="font-medium">{f.firstName} {f.lastName}</span>
                        <span className="text-muted-foreground text-xs ml-1.5">{f.farmerCode}</span>
                      </SelectItem>
                    ))
                }
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={createAllocation.isPending || !farmerId}>
              {createAllocation.isPending ? "Adding…" : "Add Farmer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
