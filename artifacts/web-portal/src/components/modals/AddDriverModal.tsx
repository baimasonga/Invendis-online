import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { createDriver, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface Props { open: boolean; onClose: () => void; }

export function AddDriverModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({ mutationFn: createDriver });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone]       = useState("");

  function reset() { setFullName(""); setPhone(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName) return;
    try {
      await create.mutateAsync({ fullName, phone: phone || undefined, isActive: 1 });
      await qc.invalidateQueries({ queryKey: KEYS.drivers() });
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
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000 000" />
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
