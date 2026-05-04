import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateVehicle, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const VEHICLE_TYPES = ["Truck", "Pick-up", "Van", "Motorcycle", "Tricycle"];

interface Props { open: boolean; onClose: () => void; }

export function AddVehicleModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateVehicle();

  const [plate, setPlate]       = useState("");
  const [type, setType]         = useState("");
  const [make, setMake]         = useState("");
  const [model, setModel]       = useState("");
  const [year, setYear]         = useState("");
  const [capacity, setCapacity] = useState("");

  function reset() { setPlate(""); setType(""); setMake(""); setModel(""); setYear(""); setCapacity(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plate || !type) return;
    const vehicleCode = "VEH-" + Date.now().toString(36).toUpperCase();
    try {
      await create.mutateAsync({
        data: {
          vehicleCode,
          plateNumber: plate.toUpperCase(),
          vehicleType: type,
          make: make || undefined,
          model: model || undefined,
          year: year ? Number(year) : undefined,
          capacity: capacity ? Number(capacity) : undefined,
          status: "Active",
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
      toast({ title: "Vehicle registered", description: `${plate.toUpperCase()} added to fleet.` });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Register Vehicle</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Plate Number *</Label>
              <Input value={plate} onChange={e => setPlate(e.target.value)} placeholder="AAA 123" required />
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
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !plate || !type}>
              {create.isPending ? "Registering…" : "Register Vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
