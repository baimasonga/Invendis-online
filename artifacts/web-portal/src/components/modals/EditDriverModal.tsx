import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { updateDriver, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onClose: () => void;
  driver: any;
}

function toDateInput(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function EditDriverModal({ open, onClose, driver }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateDriver(id, payload) });

  const [fullName, setFullName]           = useState("");
  const [phone, setPhone]                 = useState("");
  const [licence, setLicence]             = useState("");
  const [licenceExpiry, setLicenceExpiry] = useState("");
  const [isActive, setIsActive]           = useState("1");

  useEffect(() => {
    if (driver && open) {
      setFullName(driver.fullName ?? "");
      setPhone(driver.phone ?? "");
      setLicence(driver.licenseNumber ?? "");
      setLicenceExpiry(toDateInput(driver.licenseExpiry));
      setIsActive(driver.isActive ? "1" : "0");
    }
  }, [driver, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName) return;
    try {
      await updateMutation.mutateAsync({
        id: driver.id,
        payload: {
          fullName,
          phone: phone || undefined,
          licenseNumber: licence || undefined,
          licenseExpiry: licenceExpiry || undefined,
          isActive: Number(isActive),
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.drivers() });
      toast({ title: "Driver updated", description: `${fullName} updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Edit Driver</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000 000" />
            </div>
            <div className="space-y-1.5">
              <Label>Licence No.</Label>
              <Input value={licence} onChange={e => setLicence(e.target.value)} placeholder="SL-2024-0001" />
            </div>
            <div className="space-y-1.5">
              <Label>Licence Expiry</Label>
              <Input type="date" value={licenceExpiry} onChange={e => setLicenceExpiry(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={isActive} onValueChange={setIsActive}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Active</SelectItem>
                  <SelectItem value="0">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMutation.isPending || !fullName}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
