import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateDriver, getListDriversQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

export function AddDriverModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateDriver();

  const [fullName, setFullName]       = useState("");
  const [phone, setPhone]             = useState("");
  const [licence, setLicence]         = useState("");
  const [licenceExpiry, setLicenceExpiry] = useState("");

  function reset() { setFullName(""); setPhone(""); setLicence(""); setLicenceExpiry(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName) return;
    try {
      await create.mutateAsync({
        data: {
          fullName,
          phone: phone || undefined,
          licenseNumber: licence || undefined,
          licenseExpiry: licenceExpiry ? new Date(licenceExpiry) : undefined,
          isActive: 1,
        } as any,
      });
      await qc.invalidateQueries({ queryKey: getListDriversQueryKey() });
      toast({ title: "Driver registered", description: `${fullName} added to fleet.` });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Register Driver</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Mohamed Sesay" required />
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
            <div className="space-y-1.5 col-span-2">
              <Label>Licence Expiry</Label>
              <Input type="date" value={licenceExpiry} onChange={e => setLicenceExpiry(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !fullName}>
              {create.isPending ? "Registering…" : "Register Driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
