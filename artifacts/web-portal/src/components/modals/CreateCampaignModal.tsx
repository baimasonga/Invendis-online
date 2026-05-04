import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createCampaign, listDistricts, listValueChains, KEYS } from "@/lib/db";
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

export function CreateCampaignModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useMutation({ mutationFn: createCampaign });

  const [name, setName]               = useState("");
  const [districtId, setDistrictId]   = useState("");
  const [valueChainId, setValueChainId] = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [description, setDescription] = useState("");

  const { data: districts }   = useQuery({ queryKey: KEYS.districts(),   queryFn: listDistricts });
  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  function resetForm() {
    setName(""); setDistrictId(""); setValueChainId("");
    setStartDate(""); setEndDate(""); setDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !startDate || !endDate) return;
    try {
      await createMutation.mutateAsync({
        name,
        districtId: districtId ? Number(districtId) : undefined,
        valueChainId: valueChainId ? Number(valueChainId) : undefined,
        startDate,
        endDate,
        description: description || undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.campaigns() });
      toast({ title: "Campaign created", description: `"${name}" created as Draft.` });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create campaign", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cc-name">Campaign Name *</Label>
            <Input id="cc-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Freetown Seed Distribution 2026" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>District</Label>
              <Select value={districtId} onValueChange={setDistrictId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {districtList.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value Chain</Label>
              <Select value={valueChainId} onValueChange={setValueChainId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {valueChainList.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-start">Start Date *</Label>
              <Input id="cc-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-end">End Date *</Label>
              <Input id="cc-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-desc">Description</Label>
            <Input id="cc-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes…" />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
