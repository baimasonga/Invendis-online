import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWarehouse, useListDistricts, getListWarehousesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

export function AddWarehouseModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateWarehouse();

  const [code, setCode]       = useState("");
  const [name, setName]       = useState("");
  const [districtId, setDist] = useState("");
  const [address, setAddress] = useState("");

  const { data: districts } = useListDistricts();
  const districtList: any[] = (districts as any[]) ?? [];

  function reset() { setCode(""); setName(""); setDist(""); setAddress(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code || !name) return;
    try {
      await create.mutateAsync({
        data: {
          code: code.toUpperCase(),
          name,
          districtId: districtId ? Number(districtId) : undefined,
          address: address || undefined,
          isActive: 1,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
      toast({ title: "Warehouse added", description: `${name} is now available for stock operations.` });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Warehouse</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Code *</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="WH-BO" required />
          </div>
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Bo District Warehouse" required />
          </div>
          <div className="space-y-1.5">
            <Label>District</Label>
            <Select value={districtId} onValueChange={setDist}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>
                {districtList.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Dambara Road, Bo" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !code || !name}>
              {create.isPending ? "Adding…" : "Add Warehouse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
