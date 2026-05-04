import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAllocation,
  useListFarmers,
  useListCampaigns,
  getListAllocationsQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

export function NewAllocationModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateAllocation();

  const [campaignId, setCampaignId] = useState("");
  const [farmerId, setFarmerId]     = useState("");
  const [notes, setNotes]           = useState("");
  const [search, setSearch]         = useState("");

  const { data: campaignsData } = useListCampaigns({});
  const { data: farmersData }   = useListFarmers({ limit: 200, status: "approved" } as any);

  const campaigns: any[] = (campaignsData as any)?.data ?? [];
  const allFarmers: any[] = (farmersData as any)?.data ?? [];

  const filtered = search
    ? allFarmers.filter((f: any) =>
        `${f.firstName} ${f.lastName} ${f.farmerCode}`.toLowerCase().includes(search.toLowerCase()))
    : allFarmers;

  function reset() { setCampaignId(""); setFarmerId(""); setNotes(""); setSearch(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId || !farmerId) return;
    try {
      await create.mutateAsync({
        data: {
          campaignId: Number(campaignId),
          farmerId: Number(farmerId),
          notes: notes || undefined,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListAllocationsQueryKey() });
      toast({ title: "Farmer allocated to campaign" });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to allocate", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New Allocation</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Campaign *</Label>
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger><SelectValue placeholder="Select campaign…" /></SelectTrigger>
              <SelectContent>
                {campaigns.map((c: any) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Search Farmer</Label>
            <Input placeholder="Name or farmer code…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Farmer *</Label>
            <Select value={farmerId} onValueChange={setFarmerId}>
              <SelectTrigger><SelectValue placeholder="Select farmer…" /></SelectTrigger>
              <SelectContent className="max-h-60">
                {filtered.length === 0
                  ? <div className="py-6 text-center text-sm text-muted-foreground">No approved farmers</div>
                  : filtered.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        <span className="font-medium">{f.firstName} {f.lastName}</span>
                        <span className="text-muted-foreground text-xs ml-1.5">{f.farmerCode}</span>
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any additional notes…" rows={2} />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !campaignId || !farmerId}>
              {create.isPending ? "Allocating…" : "Add Allocation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
