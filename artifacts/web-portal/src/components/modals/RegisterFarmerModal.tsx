import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createFarmer, listDistricts, listChiefdoms, listValueChains, KEYS } from "@/lib/db";
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

export function RegisterFarmerModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createFarmerMutation = useMutation({ mutationFn: createFarmer });

  const [firstName, setFirstName]     = useState("");
  const [lastName, setLastName]       = useState("");
  const [gender, setGender]           = useState("");
  const [phone, setPhone]             = useState("");
  const [nationalId, setNationalId]   = useState("");
  const [districtId, setDistrictId]   = useState("");
  const [chiefdomId, setChiefdomId]   = useState("");
  const [valueChainId, setValueChainId] = useState("");

  const { data: districts }   = useQuery({ queryKey: KEYS.districts(),   queryFn: listDistricts });
  const { data: chiefdoms }   = useQuery({
    queryKey: [...KEYS.districts(), "chiefdoms", districtId],
    queryFn: () => listChiefdoms(districtId ? Number(districtId) : undefined),
    enabled: !!districtId,
  });
  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const chiefdomList:   any[] = Array.isArray(chiefdoms)   ? chiefdoms   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  function resetForm() {
    setFirstName(""); setLastName(""); setGender(""); setPhone("");
    setNationalId(""); setDistrictId(""); setChiefdomId(""); setValueChainId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName || !lastName) return;
    try {
      await createFarmerMutation.mutateAsync({
        firstName,
        lastName,
        gender: gender || undefined,
        phone: phone || undefined,
        nationalId: nationalId || undefined,
        districtId: districtId ? Number(districtId) : undefined,
        chiefdomId: chiefdomId ? Number(chiefdomId) : undefined,
        valueChainId: valueChainId ? Number(valueChainId) : undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      toast({ title: "Farmer registered", description: `${firstName} ${lastName} added successfully.` });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register Farmer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rf-first">First Name *</Label>
              <Input id="rf-first" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aminata" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-last">Last Name *</Label>
              <Input id="rf-last" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Koroma" required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rf-phone">Phone</Label>
              <Input id="rf-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000000" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-nid">National ID</Label>
            <Input id="rf-nid" value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="SL-ID-…" />
          </div>

          <div className="space-y-1.5">
            <Label>District</Label>
            <Select value={districtId} onValueChange={v => { setDistrictId(v); setChiefdomId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>
                {districtList.map((d: any) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {districtId && (
            <div className="space-y-1.5">
              <Label>Chiefdom</Label>
              <Select value={chiefdomId} onValueChange={setChiefdomId}>
                <SelectTrigger><SelectValue placeholder="Select chiefdom…" /></SelectTrigger>
                <SelectContent>
                  {chiefdomList.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Value Chain</Label>
            <Select value={valueChainId} onValueChange={setValueChainId}>
              <SelectTrigger><SelectValue placeholder="Select value chain…" /></SelectTrigger>
              <SelectContent>
                {valueChainList.map((v: any) => (
                  <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={createFarmerMutation.isPending}>
              {createFarmerMutation.isPending ? "Registering…" : "Register Farmer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
