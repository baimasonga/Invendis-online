import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { updateVehicle, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const VEHICLE_TYPES = ["Truck", "Pick-up", "Van", "Motorcycle", "Tricycle"];
const VEHICLE_STATUSES = ["Active", "In Transit", "Maintenance", "Inactive"];

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle: any;
}

export function EditVehicleModal({ open, onClose, vehicle }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateVehicle(id, payload) });

  const [plate, setPlate]       = useState("");
  const [type, setType]         = useState("");
  const [make, setMake]         = useState("");
  const [model, setModel]       = useState("");
  const [year, setYear]         = useState("");
  const [capacity, setCapacity] = useState("");
  const [status, setStatus]     = useState("");

  useEffect(() => {
    if (vehicle && open) {
      setPlate(vehicle.plateNumber ?? "");
      setType(vehicle.vehicleType ?? "");
      setMake(vehicle.make ?? "");
      setModel(vehicle.model ?? "");
      setYear(vehicle.year ? String(vehicle.year) : "");
      setCapacity(vehicle.capacity ? String(vehicle.capacity) : "");
      setStatus(vehicle.status ?? "Active");
    }
  }, [vehicle, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plate || !type) return;
    try {
      await updateMutation.mutateAsync({
        id: vehicle.id,
        payload: {
          plateNumber: plate.toUpperCase(),
          vehicleType: type,
          make: make || undefined,
          model: model || undefined,
          year: year ? Number(year) : undefined,
          capacity: capacity ? Number(capacity) : undefined,
          status,
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.vehicles() });
      toast({ title: "Vehicle updated", description: `${plate.toUpperCase()} updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Vehicle</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Plate Number *</Label>
              <Input value={plate} onChange={e => setPlate(e.target.value)} required />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Vehicle Type *</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Make</Label>
              <Input value={make} onChange={e => setMake(e.target.value)} placeholder="Toyota" />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input value={model} onChange={e => setModel(e.target.value)} placeholder="Hilux" />
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input type="number" min="2000" max="2030" value={year} onChange={e => setYear(e.target.value)} placeholder="2022" />
            </div>
            <div className="space-y-1.5">
              <Label>Capacity (kg)</Label>
              <Input type="number" min="0" step="any" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="1000" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMutation.isPending || !plate || !type}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
