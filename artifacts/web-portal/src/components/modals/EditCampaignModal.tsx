import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { updateCampaign, listDistricts, listValueChains, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
  campaign: any;
}

function toDateInput(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function EditCampaignModal({ open, onClose, campaign }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateCampaign(id, payload) });

  const [name, setName]               = useState("");
  const [season, setSeason]           = useState("");
  const [districtId, setDistrictId]   = useState("");
  const [valueChainId, setValueChainId] = useState("");
  const [startDate, setStartDate]     = useState("");
  const [endDate, setEndDate]         = useState("");
  const [notes, setNotes]             = useState("");

  useEffect(() => {
    if (campaign && open) {
      setName(campaign.name ?? "");
      setSeason(campaign.season ?? "");
      setDistrictId(campaign.districtId ? String(campaign.districtId) : "");
      setValueChainId(campaign.valueChainId ? String(campaign.valueChainId) : "");
      setStartDate(toDateInput(campaign.startDate));
      setEndDate(toDateInput(campaign.endDate));
      setNotes(campaign.notes ?? campaign.description ?? "");
    }
  }, [campaign, open]);

  const { data: districts }   = useQuery({ queryKey: KEYS.districts(),   queryFn: listDistricts });
  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !startDate || !endDate) {
      toast({ title: "Required fields missing", description: "Name, Start Date and End Date are required.", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: campaign.id,
        payload: {
          name,
          season: season || undefined,
          districtId: districtId ? Number(districtId) : undefined,
          valueChainId: valueChainId ? Number(valueChainId) : undefined,
          startDate,
          endDate,
          notes: notes || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.campaigns() });
      if (campaign.id) await qc.invalidateQueries({ queryKey: KEYS.campaign(campaign.id) });
      toast({ title: "Campaign updated", description: `"${name}" updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ec-name">Campaign Name *</Label>
            <Input id="ec-name" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ec-season">Season</Label>
            <Input id="ec-season" value={season} onChange={e => setSeason(e.target.value)} placeholder="e.g. 2026 Rainy Season" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>District</Label>
              <Select value={districtId} onValueChange={setDistrictId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">— None —</SelectItem>
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
                  <SelectItem value="0">— None —</SelectItem>
                  {valueChainList.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ec-start">Start Date *</Label>
              <Input id="ec-start" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ec-end">End Date *</Label>
              <Input id="ec-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ec-notes">Notes</Label>
            <Input id="ec-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
