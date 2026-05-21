import { useState, useEffect } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  updateFarmer, listDistricts, listChiefdoms, listValueChains, KEYS,
} from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { User, Users } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  farmer: any;
}

type BeneficiaryType = "individual" | "group";

export function EditFarmerModal({ open, onClose, farmer }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateFarmer(id, payload) });

  const [beneficiaryType, setBeneficiaryType] = useState<BeneficiaryType>("individual");
  const [firstName, setFirstName]       = useState("");
  const [lastName, setLastName]         = useState("");
  const [gender, setGender]             = useState("");
  const [phone, setPhone]               = useState("");
  const [nationalId, setNationalId]     = useState("");
  const [farmerGroup, setFarmerGroup]   = useState("");
  const [groupSize, setGroupSize]       = useState("");
  const [districtId, setDistrictId]     = useState("");
  const [chiefdomId, setChiefdomId]     = useState("");
  const [valueChainId, setValueChainId] = useState("");
  const [farmSize, setFarmSize]         = useState("");

  useEffect(() => {
    if (farmer && open) {
      setBeneficiaryType((farmer.beneficiaryType ?? "individual") as BeneficiaryType);
      setFirstName(farmer.firstName ?? "");
      setLastName(farmer.lastName ?? "");
      setGender(farmer.gender ?? "");
      setPhone(farmer.phone ?? "");
      setNationalId(farmer.nationalId ?? "");
      setFarmerGroup(farmer.farmerGroup ?? "");
      setGroupSize(farmer.groupSize ? String(farmer.groupSize) : "");
      setDistrictId(farmer.districtId ? String(farmer.districtId) : "");
      setChiefdomId(farmer.chiefdomId ? String(farmer.chiefdomId) : "");
      setValueChainId(farmer.valueChainId ? String(farmer.valueChainId) : "");
      setFarmSize(farmer.farmSize ? String(farmer.farmSize) : "");
    }
  }, [farmer, open]);

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

  const isGroup = beneficiaryType === "group";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isGroup && !farmerGroup) {
      toast({ title: "Required field missing", description: "Group Name is required.", variant: "destructive" });
      return;
    }
    if (!isGroup && (!firstName || !lastName)) {
      toast({ title: "Required fields missing", description: "First Name and Last Name are required.", variant: "destructive" });
      return;
    }
    if (!districtId) {
      toast({ title: "Required field missing", description: "District is required.", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: farmer.id,
        payload: {
          beneficiaryType,
          firstName,
          lastName,
          gender:       isGroup ? undefined : (gender || undefined),
          phone:        phone || undefined,
          nationalId:   isGroup ? undefined : (nationalId || undefined),
          farmerGroup:  farmerGroup || undefined,
          groupSize:    groupSize ? Number(groupSize) : undefined,
          districtId:   districtId ? Number(districtId) : undefined,
          chiefdomId:   chiefdomId ? Number(chiefdomId) : undefined,
          valueChainId: valueChainId ? Number(valueChainId) : undefined,
          farmSize:     !isGroup && farmSize ? Number(farmSize) : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      if (farmer.id) await qc.invalidateQueries({ queryKey: KEYS.farmer(farmer.id) });
      const label = isGroup ? farmerGroup : `${firstName} ${lastName}`.trim();
      toast({ title: "Beneficiary updated", description: `${label} updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Beneficiary</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">

          {/* Beneficiary type toggle */}
          <div className="space-y-1.5">
            <Label>Beneficiary Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBeneficiaryType("individual")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  !isGroup
                    ? "border-green-700 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 dark:border-green-600"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <User className="h-4 w-4" /> Individual
              </button>
              <button
                type="button"
                onClick={() => setBeneficiaryType("group")}
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  isGroup
                    ? "border-green-700 bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300 dark:border-green-600"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Users className="h-4 w-4" /> Group
              </button>
            </div>
          </div>

          {/* ── GROUP fields ── */}
          {isGroup && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ef-group-name">Group / Cooperative Name *</Label>
                <Input
                  id="ef-group-name"
                  value={farmerGroup}
                  onChange={e => setFarmerGroup(e.target.value)}
                  placeholder="e.g. Kono Women Farmers Cooperative"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ef-contact-first">Contact First Name</Label>
                  <Input id="ef-contact-first" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aminata" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ef-contact-last">Contact Last Name</Label>
                  <Input id="ef-contact-last" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Koroma" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ef-group-size">Number of Members</Label>
                  <Input id="ef-group-size" type="number" min="1" value={groupSize} onChange={e => setGroupSize(e.target.value)} placeholder="e.g. 25" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ef-group-phone">Contact Phone</Label>
                  <Input id="ef-group-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000000" />
                </div>
              </div>
            </>
          )}

          {/* ── INDIVIDUAL fields ── */}
          {!isGroup && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ef-first">First Name *</Label>
                  <Input id="ef-first" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ef-last">Last Name *</Label>
                  <Input id="ef-last" value={lastName} onChange={e => setLastName(e.target.value)} required />
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
                  <Label htmlFor="ef-phone">Phone</Label>
                  <Input id="ef-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000000" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ef-nid">National ID</Label>
                  <Input id="ef-nid" value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="SL-ID-…" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ef-farm">Farm Size (ha)</Label>
                  <Input id="ef-farm" type="number" min="0" step="any" value={farmSize} onChange={e => setFarmSize(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ef-farmer-group">Farmer Group / Cooperative</Label>
                <Input id="ef-farmer-group" value={farmerGroup} onChange={e => setFarmerGroup(e.target.value)} placeholder="Optional" />
              </div>
            </>
          )}

          {/* ── Common location fields ── */}
          <div className="space-y-1.5">
            <Label>District *</Label>
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
