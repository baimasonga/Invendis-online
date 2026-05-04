import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createDispatch, listCampaigns, listVehicles, listDrivers, listWarehouses, KEYS } from "@/lib/db";
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

export function CreateManifestModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useMutation({ mutationFn: createDispatch });

  const [campaignId, setCampaignId]     = useState("");
  const [vehicleId, setVehicleId]       = useState("");
  const [driverId, setDriverId]         = useState("");
  const [warehouseId, setWarehouseId]   = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [notes, setNotes]               = useState("");

  const { data: campaignsData } = useQuery({ queryKey: KEYS.campaigns(),  queryFn: () => listCampaigns(1, 100) });
  const { data: vehiclesData }  = useQuery({ queryKey: KEYS.vehicles(),   queryFn: () => listVehicles(1, 200) });
  const { data: driversData }   = useQuery({ queryKey: KEYS.drivers(),    queryFn: () => listDrivers(1, 200) });
  const { data: warehouses }    = useQuery({ queryKey: KEYS.warehouses(), queryFn: listWarehouses });

  const campaigns:     any[] = (campaignsData as any)?.data ?? [];
  const vehicleList:   any[] = (vehiclesData as any)?.data  ?? [];
  const driverList:    any[] = (driversData as any)?.data   ?? [];
  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];

  function resetForm() {
    setCampaignId(""); setVehicleId(""); setDriverId("");
    setWarehouseId(""); setScheduledDate(""); setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId || !vehicleId || !warehouseId) return;
    try {
      await createMutation.mutateAsync({
        campaignId: Number(campaignId),
        vehicleId: Number(vehicleId),
        driverId: driverId ? Number(driverId) : undefined,
        warehouseId: Number(warehouseId),
        scheduledDate: scheduledDate || undefined,
        notes: notes || undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.dispatches() });
      toast({ title: "Manifest created", description: "Dispatch manifest created as Pending." });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create manifest", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Dispatch Manifest</DialogTitle>
        </DialogHeader>
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
            <Label>Source Warehouse *</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue placeholder="Select warehouse…" /></SelectTrigger>
              <SelectContent>
                {warehouseList.map((w: any) => (
                  <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vehicle *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {vehicleList.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.plateNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Driver</Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {driverList.map((d: any) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-date">Scheduled Date</Label>
            <Input id="cm-date" type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-notes">Notes</Label>
            <Input id="cm-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Manifest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
