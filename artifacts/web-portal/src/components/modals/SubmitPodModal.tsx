import { useState, useCallback } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { createPod, listFarmers, listDispatches, getFarmer, sendOtp, verifyOtp, KEYS } from "@/lib/db";
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
import { FaceVerification, type FaceResult } from "@/components/FaceVerification";
import {
  CheckCircle, Loader2, MapPin, MessageSquare, ScanFace, ClipboardList, ChevronRight, ChevronLeft,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  open: boolean;
  onClose: () => void;
  prefilledDispatchId?: number;
}

type Step = "details" | "otp" | "face" | "gps" | "confirm";

const STEPS: Step[] = ["details", "otp", "face", "gps", "confirm"];

const STEP_LABELS: Record<Step, string> = {
  details: "Details",
  otp: "OTP",
  face: "Biometric",
  gps: "GPS",
  confirm: "Submit",
};

const STEP_ICONS: Record<Step, React.ReactNode> = {
  details: <ClipboardList className="h-4 w-4" />,
  otp: <MessageSquare className="h-4 w-4" />,
  face: <ScanFace className="h-4 w-4" />,
  gps: <MapPin className="h-4 w-4" />,
  confirm: <CheckCircle className="h-4 w-4" />,
};

export function SubmitPodModal({ open, onClose, prefilledDispatchId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("details");

  const [farmerId, setFarmerId]     = useState("");
  const [dispatchId, setDispatchId] = useState(prefilledDispatchId ? String(prefilledDispatchId) : "");
  const [qty, setQty]               = useState("");
  const [notes, setNotes]           = useState("");
  const [farmerSearch, setFarmerSearch] = useState("");

  const [otpSent, setOtpSent]       = useState(false);
  const [otpCode, setOtpCode]       = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpBypassed, setOtpBypassed] = useState(false);
  const [otpBypassReason, setOtpBypassReason] = useState("");
  const [otpMaskedPhone, setOtpMaskedPhone] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError]     = useState("");
  const [showOtpBypass, setShowOtpBypass] = useState(false);

  const [faceResult, setFaceResult] = useState<FaceResult | null>(null);
  const [faceBypassed, setFaceBypassed] = useState(false);
  const [facePhotoBlob, setFacePhotoBlob] = useState<Blob | null>(null);

  const [gpsLat, setGpsLat]         = useState<number | null>(null);
  const [gpsLng, setGpsLng]         = useState<number | null>(null);
  const [gpsCapturing, setGpsCapturing] = useState(false);
  const [gpsError, setGpsError]     = useState("");

  const { data: farmersData }    = useQuery({ queryKey: KEYS.farmers(), queryFn: () => listFarmers(1, 500) });
  const { data: dispatchesData } = useQuery({ queryKey: KEYS.dispatches(), queryFn: () => listDispatches(1, 100) });
  const { data: farmerDetail }   = useQuery({
    queryKey: KEYS.farmer(Number(farmerId)),
    queryFn: () => getFarmer(Number(farmerId)),
    enabled: !!farmerId,
  });

  const farmers    = (farmersData as any)?.data   ?? [];
  const dispatches = (dispatchesData as any)?.data ?? [];
  const filteredFarmers = farmerSearch
    ? farmers.filter((f: any) => `${f.firstName} ${f.lastName} ${f.farmerCode}`.toLowerCase().includes(farmerSearch.toLowerCase()))
    : farmers;

  const selectedDispatch = dispatches.find((d: any) => String(d.id) === dispatchId);

  const submitMutation = useMutation({ mutationFn: createPod });

  function reset() {
    setStep("details");
    setFarmerId(""); setQty(""); setNotes(""); setFarmerSearch("");
    if (!prefilledDispatchId) setDispatchId("");
    setOtpSent(false); setOtpCode(""); setOtpVerified(false); setOtpBypassed(false);
    setOtpBypassReason(""); setOtpMaskedPhone(""); setOtpError(""); setShowOtpBypass(false);
    setFaceResult(null); setFaceBypassed(false); setFacePhotoBlob(null);
    setGpsLat(null); setGpsLng(null); setGpsError("");
  }

  async function handleSendOtp() {
    if (!farmerId) return;
    setOtpSending(true);
    setOtpError("");
    try {
      const res = await sendOtp(Number(farmerId));
      setOtpMaskedPhone(res.maskedPhone ?? "");
      setOtpSent(true);
      if (res.devCode) {
        toast({ title: "Dev mode — OTP code", description: `Code: ${res.devCode}` });
      }
    } catch (e: any) {
      setOtpError(e.message);
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) return;
    setOtpVerifying(true);
    setOtpError("");
    try {
      await verifyOtp(Number(farmerId), otpCode.trim());
      setOtpVerified(true);
    } catch (e: any) {
      setOtpError(e.message);
    } finally {
      setOtpVerifying(false);
    }
  }

  function handleOtpBypass() {
    if (!otpBypassReason.trim()) return;
    setOtpBypassed(true);
    setShowOtpBypass(false);
  }

  function handleFaceResult(result: FaceResult) {
    setFaceResult(result);
    if ("photoBlob" in result) setFacePhotoBlob(result.photoBlob);
  }

  function handleFaceBypass(reason: string) {
    setFaceResult({ status: "bypassed", reason });
    setFaceBypassed(true);
  }

  function captureGps() {
    setGpsCapturing(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsLat(pos.coords.latitude);
        setGpsLng(pos.coords.longitude);
        setGpsCapturing(false);
      },
      err => {
        setGpsError("Could not get location: " + err.message);
        setGpsCapturing(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function handleSubmit() {
    if (!farmerId || !qty) return;

    let photoUrl: string | undefined;

    if (facePhotoBlob) {
      const fileName = `pod/${farmerId}_${Date.now()}.jpg`;
      const { data: uploadData } = await supabase.storage
        .from("pod-photos")
        .upload(fileName, facePhotoBlob, { contentType: "image/jpeg", upsert: true });
      if (uploadData) {
        const { data: urlData } = supabase.storage.from("pod-photos").getPublicUrl(fileName);
        photoUrl = urlData.publicUrl;
      }
    }

    const otpStatus = otpVerified ? "Verified" : otpBypassed ? "Bypassed" : "Pending";
    let faceStatus = "Pending";
    if (faceResult) {
      if (faceResult.status === "match") faceStatus = "Verified";
      else if (faceResult.status === "no_match") faceStatus = "Failed";
      else if (faceResult.status === "no_ref") faceStatus = "Captured";
      else if (faceResult.status === "bypassed") faceStatus = "Bypassed";
    }

    const bypassNotes = [
      otpBypassed ? `OTP bypassed: ${otpBypassReason}` : "",
      faceResult?.status === "bypassed" ? `Face bypassed: ${faceResult.reason}` : "",
      notes,
    ].filter(Boolean).join(" | ");

    try {
      await submitMutation.mutateAsync({
        farmerId: Number(farmerId),
        dispatchId: dispatchId ? Number(dispatchId) : undefined,
        campaignId: selectedDispatch?.campaignId ?? undefined,
        quantityDelivered: Number(qty),
        notes: bypassNotes || undefined,
        otpStatus,
        faceStatus,
        photoUrl,
        farmerLatitude: gpsLat ?? undefined,
        farmerLongitude: gpsLng ?? undefined,
        status: otpVerified && (faceResult?.status === "match" || faceResult?.status === "no_ref")
          ? "Verified" : "Pending",
      });
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      toast({ title: "Delivery recorded", description: `PoD submitted — OTP: ${otpStatus}, Face: ${faceStatus}` });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to submit PoD", description: err.message, variant: "destructive" });
    }
  }

  const canProceedDetails = !!farmerId && !!qty;
  const canProceedOtp     = otpVerified || otpBypassed;
  const canProceedFace    = !!faceResult;
  const canProceedGps     = true;

  const currentIdx = STEPS.indexOf(step);

  function goNext() { if (currentIdx < STEPS.length - 1) setStep(STEPS[currentIdx + 1]); }
  function goBack() { if (currentIdx > 0) setStep(STEPS[currentIdx - 1]); }

  const farmer = farmerDetail as any;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Record Delivery — Proof of Delivery</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 mb-2">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 flex flex-col items-center gap-0.5 ${i <= currentIdx ? "opacity-100" : "opacity-40"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs transition-colors ${i < currentIdx ? "bg-green-600" : i === currentIdx ? "bg-green-700" : "bg-gray-200 text-gray-500"}`}>
                {i < currentIdx ? <CheckCircle className="h-4 w-4" /> : STEP_ICONS[s]}
              </div>
              <span className="text-[10px] text-muted-foreground">{STEP_LABELS[s]}</span>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 pr-1">

          {step === "details" && (
            <div className="space-y-3">
              {!prefilledDispatchId && (
                <div className="space-y-1.5">
                  <Label>Dispatch Manifest</Label>
                  <Select value={dispatchId} onValueChange={setDispatchId}>
                    <SelectTrigger><SelectValue placeholder="Select manifest…" /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {dispatches.map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          <span className="font-mono text-xs">{d.manifestCode}</span>
                          <span className="text-muted-foreground ml-1.5">— {d.campaignName ?? "No campaign"}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Farmer *</Label>
                <Input
                  placeholder="Search by name or code…"
                  value={farmerSearch}
                  onChange={e => setFarmerSearch(e.target.value)}
                  className="mb-1"
                />
                <Select value={farmerId} onValueChange={setFarmerId}>
                  <SelectTrigger><SelectValue placeholder="Select farmer…" /></SelectTrigger>
                  <SelectContent className="max-h-52">
                    {filteredFarmers.slice(0, 50).map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.firstName} {f.lastName}
                        <span className="text-muted-foreground text-xs ml-1.5">{f.farmerCode}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Qty Delivered *</Label>
                  <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional…" />
                </div>
              </div>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-sm font-medium text-blue-900">SMS Verification</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  {farmer ? `Farmer: ${farmer.firstName} ${farmer.lastName} (${farmer.farmerCode})` : "Loading farmer…"}
                </p>
                {farmer?.phone && (
                  <p className="text-xs text-blue-700">Phone: {farmer.phone}</p>
                )}
              </div>

              {!otpVerified && !otpBypassed && (
                <>
                  {!otpSent ? (
                    <Button type="button" onClick={handleSendOtp} disabled={otpSending || !farmer?.phone} className="w-full bg-green-700 hover:bg-green-800 text-white">
                      {otpSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                      {otpSending ? "Sending…" : farmer?.phone ? "Send OTP to Farmer" : "Farmer has no phone number"}
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Label>Enter 6-digit OTP sent to {otpMaskedPhone}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="000000"
                          className="font-mono text-xl tracking-widest text-center"
                        />
                        <Button type="button" onClick={handleVerifyOtp} disabled={otpCode.length !== 6 || otpVerifying}>
                          {otpVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                        </Button>
                      </div>
                      <Button type="button" variant="link" size="sm" onClick={() => { setOtpSent(false); setOtpCode(""); }}>
                        Resend OTP
                      </Button>
                    </div>
                  )}
                  {otpError && <p className="text-sm text-red-600">{otpError}</p>}
                  <div className="pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowOtpBypass(v => !v)}>
                      Bypass OTP (exception)
                    </Button>
                    {showOtpBypass && (
                      <div className="mt-2 space-y-2 border rounded-lg p-3 bg-amber-50">
                        <p className="text-xs text-amber-800 font-medium">State reason for bypassing OTP:</p>
                        <Input
                          placeholder="e.g. No signal, farmer no phone…"
                          value={otpBypassReason}
                          onChange={e => setOtpBypassReason(e.target.value)}
                        />
                        <Button type="button" size="sm" variant="outline" onClick={handleOtpBypass} disabled={!otpBypassReason.trim()}>
                          Confirm Bypass
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}

              {otpVerified && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">OTP Verified Successfully</span>
                </div>
              )}
              {otpBypassed && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">OTP Bypassed — {otpBypassReason}</span>
                </div>
              )}
            </div>
          )}

          {step === "face" && (
            <div className="space-y-3">
              <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
                <p className="text-sm font-medium text-purple-900">Biometric Face Verification</p>
                <p className="text-xs text-purple-700 mt-0.5">
                  {farmer?.photoUrl
                    ? "Live face will be compared against farmer's registered photo."
                    : "No registered photo — face will be captured for records."}
                </p>
              </div>
              {!faceResult ? (
                <FaceVerification
                  farmerPhotoUrl={farmer?.photoUrl}
                  farmerName={farmer ? `${farmer.firstName} ${farmer.lastName}` : ""}
                  onResult={handleFaceResult}
                  onBypass={handleFaceBypass}
                />
              ) : (
                <div className={`rounded-lg p-3 flex items-center gap-3 ${
                  faceResult.status === "match" ? "bg-green-50 border border-green-200" :
                  faceResult.status === "no_match" ? "bg-red-50 border border-red-200" :
                  "bg-amber-50 border border-amber-200"
                }`}>
                  <CheckCircle className={`h-5 w-5 shrink-0 ${
                    faceResult.status === "match" ? "text-green-600" :
                    faceResult.status === "no_match" ? "text-red-600" : "text-amber-600"
                  }`} />
                  <div>
                    {faceResult.status === "match" && <p className="text-sm font-medium text-green-800">Face matched — {("confidence" in faceResult) ? faceResult.confidence : 0}% confidence</p>}
                    {faceResult.status === "no_match" && <p className="text-sm font-medium text-red-800">Face did not match — will require review</p>}
                    {faceResult.status === "no_ref" && <p className="text-sm font-medium text-amber-800">Photo captured for records</p>}
                    {faceResult.status === "bypassed" && <p className="text-sm font-medium text-amber-800">Bypassed: {faceResult.reason}</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "gps" && (
            <div className="space-y-4">
              <div className="rounded-lg bg-teal-50 border border-teal-200 p-3">
                <p className="text-sm font-medium text-teal-900">GPS Location</p>
                <p className="text-xs text-teal-700 mt-0.5">Capture current location to verify delivery site.</p>
              </div>
              {gpsLat && gpsLng ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="h-5 w-5" />
                    <span className="text-sm font-medium">Location captured</span>
                  </div>
                  <p className="text-xs text-green-600 font-mono pl-7">
                    {gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}
                  </p>
                </div>
              ) : (
                <Button
                  type="button"
                  onClick={captureGps}
                  disabled={gpsCapturing}
                  className="w-full bg-teal-700 hover:bg-teal-800 text-white"
                >
                  {gpsCapturing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MapPin className="h-4 w-4 mr-2" />}
                  {gpsCapturing ? "Getting location…" : "Capture GPS Location"}
                </Button>
              )}
              {gpsError && <p className="text-sm text-red-600">{gpsError}</p>}
              {!gpsLat && (
                <Button type="button" variant="link" size="sm" onClick={() => goNext()} className="text-xs">
                  Skip GPS →
                </Button>
              )}
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-3">
              <div className="rounded-lg border divide-y text-sm">
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">Farmer</span>
                  <span className="font-medium">{farmer ? `${farmer.firstName} ${farmer.lastName}` : farmerId}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">Dispatch</span>
                  <span className="font-mono text-xs">{selectedDispatch?.manifestCode ?? "None"}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">Quantity</span>
                  <span className="font-medium">{qty}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">OTP Status</span>
                  <span className={otpVerified ? "text-green-600 font-medium" : otpBypassed ? "text-amber-600" : "text-gray-500"}>
                    {otpVerified ? "✓ Verified" : otpBypassed ? "Bypassed" : "Pending"}
                  </span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">Face Status</span>
                  <span className={
                    faceResult?.status === "match" ? "text-green-600 font-medium" :
                    faceResult?.status === "no_match" ? "text-red-600" :
                    faceResult?.status === "no_ref" ? "text-amber-600" :
                    faceResult?.status === "bypassed" ? "text-amber-600" : "text-gray-500"
                  }>
                    {faceResult?.status === "match" ? "✓ Matched" :
                     faceResult?.status === "no_match" ? "✗ No match" :
                     faceResult?.status === "no_ref" ? "Captured" :
                     faceResult?.status === "bypassed" ? "Bypassed" : "Pending"}
                  </span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-muted-foreground">GPS</span>
                  <span className={gpsLat ? "text-green-600 font-medium" : "text-gray-400"}>
                    {gpsLat ? `✓ ${gpsLat.toFixed(4)}, ${gpsLng?.toFixed(4)}` : "Not captured"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t flex justify-between gap-2">
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>
              Cancel
            </Button>
            {step !== "details" && (
              <Button type="button" variant="outline" onClick={goBack}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
          </div>

          {step !== "confirm" ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={
                (step === "details" && !canProceedDetails) ||
                (step === "otp" && !canProceedOtp) ||
                (step === "face" && !canProceedFace)
              }
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitMutation.isPending || !farmerId || !qty}
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {submitMutation.isPending ? "Submitting…" : "Submit PoD"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
