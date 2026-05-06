import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createDispatch, listCampaigns, listVehicles, listDrivers, listWarehouses, KEYS } from "@/lib/db";
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
import { useToast } from "@/hooks/use-toast";
import { Truck, Car } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type VehicleMode = "office" | "hired";

export function CreateManifestModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useMutation({ mutationFn: createDispatch });

  const [campaignId, setCampaignId]       = useState("");
  const [warehouseId, setWarehouseId]     = useState("");
  const [vehicleMode, setVehicleMode]     = useState<VehicleMode>("office");

  // Office vehicle fields
  const [vehicleId, setVehicleId]         = useState("");
  const [driverId, setDriverId]           = useState("");

  // Hired truck fields
  const [hiredPlate, setHiredPlate]       = useState("");
  const [hiredDriver, setHiredDriver]     = useState("");
  const [hiredMake, setHiredMake]         = useState("");
  const [hiredPhone, setHiredPhone]       = useState("");

  const [notes, setNotes]                 = useState("");

  const { data: campaignsData } = useQuery({ queryKey: KEYS.campaigns(),  queryFn: () => listCampaigns(1, 100) });
  const { data: vehiclesData }  = useQuery({ queryKey: KEYS.vehicles(),   queryFn: () => listVehicles(1, 200) });
  const { data: driversData }   = useQuery({ queryKey: KEYS.drivers(),    queryFn: () => listDrivers(1, 200) });
  const { data: warehouses }    = useQuery({ queryKey: KEYS.warehouses(), queryFn: listWarehouses });

  const campaigns:     any[] = (campaignsData as any)?.data ?? [];
  const vehicleList:   any[] = (vehiclesData as any)?.data  ?? [];
  const driverList:    any[] = (driversData as any)?.data   ?? [];
  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];

  function resetForm() {
    setCampaignId(""); setWarehouseId(""); setVehicleMode("office");
    setVehicleId(""); setDriverId("");
    setHiredPlate(""); setHiredDriver(""); setHiredMake(""); setHiredPhone("");
    setNotes("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId || !warehouseId) return;
    if (vehicleMode === "office" && !vehicleId) return;
    if (vehicleMode === "hired" && !hiredPlate.trim()) return;

    const payload: any = {
      campaignId: Number(campaignId),
      warehouseId: Number(warehouseId),
      vehicleType: vehicleMode,
      notes: notes.trim() || undefined,
    };

    if (vehicleMode === "office") {
      payload.vehicleId = Number(vehicleId);
      payload.driverId = driverId ? Number(driverId) : undefined;
    } else {
      payload.hiredPlate = hiredPlate.trim().toUpperCase();
      payload.hiredDriverName = hiredDriver.trim() || undefined;
      // Encode make/phone into notes if provided
      const extras = [
        hiredMake.trim() ? `Make/Model: ${hiredMake.trim()}` : "",
        hiredPhone.trim() ? `Phone: ${hiredPhone.trim()}` : "",
        notes.trim(),
      ].filter(Boolean).join(" | ");
      if (extras) payload.notes = extras;
    }

    try {
      await createMutation.mutateAsync(payload);
      await qc.invalidateQueries({ queryKey: KEYS.dispatches() });
      toast({ title: "Manifest created", description: "Dispatch manifest created as Pending." });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create manifest", description: err.message, variant: "destructive" });
    }
  }

  const modeTab = (mode: VehicleMode, label: string, Icon: React.ElementType) => (
    <button
      type="button"
      onClick={() => setVehicleMode(mode)}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border",
        vehicleMode === mode
          ? "bg-green-700 text-white border-green-700 shadow-sm"
          : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Dispatch Manifest</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Campaign + Warehouse */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Campaign <span className="text-red-500">*</span></Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {campaigns.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Source Warehouse <span className="text-red-500">*</span></Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {warehouseList.map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Vehicle type toggle */}
          <div className="space-y-2.5">
            <Label>Vehicle Type</Label>
            <div className="flex gap-2">
              {modeTab("office", "Office Vehicle", Car)}
              {modeTab("hired", "Hired Truck", Truck)}
            </div>
          </div>

          {/* Office vehicle fields */}
          {vehicleMode === "office" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vehicle <span className="text-red-500">*</span></Label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {vehicleList.map((v: any) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.plateNumber}
                        {v.make ? ` — ${v.make}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Driver</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {driverList.map((d: any) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Hired truck fields */}
          {vehicleMode === "hired" && (
            <div className="space-y-3 rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" />
                Privately hired vehicle — not in vehicle registry
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plate Number <span className="text-red-500">*</span></Label>
                  <Input
                    value={hiredPlate}
                    onChange={e => setHiredPlate(e.target.value)}
                    placeholder="e.g. AJW-238"
                    className="uppercase placeholder:normal-case"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Driver Name</Label>
                  <Input
                    value={hiredDriver}
                    onChange={e => setHiredDriver(e.target.value)}
                    placeholder="Full name…"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Make / Model</Label>
                  <Input
                    value={hiredMake}
                    onChange={e => setHiredMake(e.target.value)}
                    placeholder="e.g. Isuzu Dmax"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Driver Phone</Label>
                  <Input
                    value={hiredPhone}
                    onChange={e => setHiredPhone(e.target.value)}
                    placeholder="+232 …"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes — only shown explicitly for office mode; for hired it's folded into the section above */}
          {vehicleMode === "office" && (
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes about this dispatch…"
                rows={2}
                className="resize-none"
              />
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create Manifest"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
