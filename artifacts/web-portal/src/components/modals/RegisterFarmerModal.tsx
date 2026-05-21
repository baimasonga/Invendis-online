import { useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import {
  createFarmer, listDistricts, listChiefdoms, listValueChains, KEYS,
  getFaceUploadUrl, uploadBlobToS3, saveFaceReference,
} from "@/lib/db";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BiometricCapture } from "@/components/BiometricCapture";
import { CheckCircle, User, Users } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Step = "details" | "biometric";
type BeneficiaryType = "individual" | "group";

export function RegisterFarmerModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createFarmerMutation = useMutation({ mutationFn: createFarmer });

  const [step, setStep]                       = useState<Step>("details");
  const [createdFarmer, setCreatedFarmer]     = useState<any>(null);
  const [uploading, setUploading]             = useState(false);

  const [beneficiaryType, setBeneficiaryType] = useState<BeneficiaryType>("individual");
  const [firstName, setFirstName]     = useState("");
  const [lastName, setLastName]       = useState("");
  const [gender, setGender]           = useState("");
  const [phone, setPhone]             = useState("");
  const [nationalId, setNationalId]   = useState("");
  const [farmerGroup, setFarmerGroup] = useState("");
  const [groupSize, setGroupSize]     = useState("");
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

  const isGroup = beneficiaryType === "group";

  function resetAll() {
    setStep("details");
    setCreatedFarmer(null);
    setBeneficiaryType("individual");
    setFirstName(""); setLastName(""); setGender(""); setPhone("");
    setNationalId(""); setFarmerGroup(""); setGroupSize("");
    setDistrictId(""); setChiefdomId(""); setValueChainId("");
  }

  function handleClose() { resetAll(); onClose(); }

  async function handleDetailsSubmit(e: React.FormEvent) {
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
      const farmer = await createFarmerMutation.mutateAsync({
        beneficiaryType,
        firstName:    isGroup ? (firstName || "—") : firstName,
        lastName:     isGroup ? (lastName  || "—") : lastName,
        gender:       isGroup ? undefined : (gender || undefined),
        phone:        phone || undefined,
        nationalId:   isGroup ? undefined : (nationalId || undefined),
        farmerGroup:  farmerGroup || undefined,
        groupSize:    groupSize ? Number(groupSize) : undefined,
        districtId:   districtId ? Number(districtId) : undefined,
        chiefdomId:   chiefdomId ? Number(chiefdomId) : undefined,
        valueChainId: valueChainId ? Number(valueChainId) : undefined,
      });
      setCreatedFarmer(farmer);
      setStep("biometric");
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    }
  }

  async function handleBiometricCapture(blob: Blob) {
    if (!createdFarmer) return;
    setUploading(true);
    try {
      const { uploadUrl, key } = await getFaceUploadUrl(createdFarmer.id, "reference");
      await uploadBlobToS3(uploadUrl, blob);
      await saveFaceReference(createdFarmer.id, key);
      toast({ title: "Biometric saved", description: "Reference photo stored successfully." });
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleBiometricDone() {
    qc.invalidateQueries({ queryKey: KEYS.farmers() });
    const label = isGroup ? farmerGroup : `${firstName} ${lastName}`.trim();
    toast({ title: "Beneficiary registered", description: `${label} added successfully.` });
    handleClose();
  }

  function handleSkip() {
    qc.invalidateQueries({ queryKey: KEYS.farmers() });
    const label = isGroup ? farmerGroup : `${firstName} ${lastName}`.trim();
    toast({ title: "Beneficiary registered", description: `${label} registered (no photo).` });
    handleClose();
  }

  const displayName = isGroup
    ? (farmerGroup || "Group")
    : (`${firstName} ${lastName}`.trim() || "Beneficiary");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Register Beneficiary
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
              {step === "details"
                ? <><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-700 text-white text-[10px]">1</span> Details</>
                : <><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground text-[10px]">✓</span> Details</>
              }
              <span className="mx-1 text-muted-foreground/40">→</span>
              {step === "biometric"
                ? <><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-700 text-white text-[10px]">2</span> Biometric</>
                : <><span className="inline-flex items-center justify-center w-5 h-5 rounded-full border text-muted-foreground text-[10px]">2</span> Biometric</>
              }
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Details ─────────────────────────────────────────────── */}
        {step === "details" && (
          <form onSubmit={handleDetailsSubmit} className="space-y-4 py-1">

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
                  <Label htmlFor="rf-group-name">Group / Cooperative Name *</Label>
                  <Input
                    id="rf-group-name"
                    value={farmerGroup}
                    onChange={e => setFarmerGroup(e.target.value)}
                    placeholder="e.g. Kono Women Farmers Cooperative"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-contact-first">Contact Person — First Name</Label>
                    <Input id="rf-contact-first" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aminata" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-contact-last">Contact Person — Last Name</Label>
                    <Input id="rf-contact-last" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Koroma" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-group-size">Number of Members</Label>
                    <Input id="rf-group-size" type="number" min="1" value={groupSize} onChange={e => setGroupSize(e.target.value)} placeholder="e.g. 25" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-group-phone">Contact Phone</Label>
                    <Input id="rf-group-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+232 76 000000" />
                  </div>
                </div>
              </>
            )}

            {/* ── INDIVIDUAL fields ── */}
            {!isGroup && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-first">First Name *</Label>
                    <Input id="rf-first" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Aminata" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-last">Last Name *</Label>
                    <Input id="rf-last" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Koroma" />
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-nid">National ID</Label>
                    <Input id="rf-nid" value={nationalId} onChange={e => setNationalId(e.target.value)} placeholder="SL-ID-…" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rf-farmer-group">Farmer Group / Cooperative</Label>
                    <Input id="rf-farmer-group" value={farmerGroup} onChange={e => setFarmerGroup(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
              </>
            )}

            {/* ── Common location + value chain ── */}
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

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                type="submit"
                className="flex-1 bg-green-700 hover:bg-green-800 text-white"
                disabled={createFarmerMutation.isPending}
              >
                {createFarmerMutation.isPending ? "Registering…" : "Next: Capture Photo →"}
              </Button>
            </div>
          </form>
        )}

        {/* ── Step 2: Biometric ────────────────────────────────────────────── */}
        {step === "biometric" && createdFarmer && (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-2.5">
              <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-green-800">{displayName}</span>
                <span className="text-green-700"> registered as </span>
                <span className="font-mono text-xs text-green-700">{createdFarmer.farmerCode}</span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {isGroup
                ? "Optionally capture a reference photo of the group contact person for identity verification."
                : "Capture a reference photo for biometric identity verification during distributions."}
            </p>

            <BiometricCapture
              farmerId={createdFarmer.id}
              farmerName={displayName}
              onCapture={handleBiometricCapture}
              onSkip={handleSkip}
              uploading={uploading}
            />

            {!uploading && (
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  onClick={handleBiometricDone}
                  className="bg-green-700 hover:bg-green-800 text-white"
                >
                  Finish Registration
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
