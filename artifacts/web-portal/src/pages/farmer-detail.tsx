import { useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getFarmer, approveFarmer, rejectFarmer, getFaceViewUrl,
  getFaceUploadUrl, uploadBlobToS3, saveFaceReference, analyseFarmerFace, farmerDisplayName, KEYS,
} from "@/lib/db";
import { EditFarmerModal } from "@/components/modals/EditFarmerModal";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, User, Users, MapPin, Sprout, Hash, Phone, IdCard, CheckCircle2, XCircle, Camera, Upload, Loader2, Pencil, ScanFace, Star, Eye, Smile, Zap, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FarmerIdCard } from "@/components/FarmerIdCard";
import { StatusBadge } from "@/components/StatusBadge";

function Field({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: React.ElementType }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function FarmerDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editOpen, setEditOpen]       = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen]   = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [faceAnalysing, setFaceAnalysing] = useState(false);
  const [faceAnalysis, setFaceAnalysis] = useState<{
    ageRangeLow: number | null; ageRangeHigh: number | null;
    gender: string | null; genderConfidence: number | null;
    smile: boolean | null; eyesOpen: boolean | null;
    primaryEmotion: string | null; primaryEmotionConfidence: number | null;
    faceQuality: number | null; brightness: number | null; sharpness: number | null;
    faceCount: number;
  } | null>(null);

  const { data: farmer, isLoading } = useQuery({
    queryKey: KEYS.farmer(id),
    queryFn: () => getFarmer(id),
    enabled: !!id,
  });

  const photoKey: string | null = (farmer as any)?.photoUrl ?? null;
  const { data: photoSrc, isLoading: photoLoading } = useQuery({
    queryKey: ["face-view-url", photoKey],
    queryFn: () => getFaceViewUrl(photoKey!),
    enabled: !!photoKey,
    staleTime: 1000 * 60 * 10,
  });

  const approveMutation = useMutation({ mutationFn: () => approveFarmer(id) });
  const rejectMutation  = useMutation({ mutationFn: () => rejectFarmer(id) });

  async function handleApproveConfirm() {
    setActionLoading(true);
    try {
      await approveMutation.mutateAsync();
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.farmer(id) }),
        qc.invalidateQueries({ queryKey: KEYS.farmers() }),
      ]);
      toast({ title: "Farmer approved" });
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(false); setApproveOpen(false); }
  }

  async function handleRejectConfirm() {
    setActionLoading(true);
    try {
      await rejectMutation.mutateAsync();
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.farmer(id) }),
        qc.invalidateQueries({ queryKey: KEYS.farmers() }),
      ]);
      toast({ title: "Farmer rejected" });
    } catch (err: any) {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(false); setRejectOpen(false); }
  }

  async function handleAnalyseFace() {
    if (!photoKey) return;
    setFaceAnalysing(true);
    try {
      const result = await analyseFarmerFace(photoKey, id);
      setFaceAnalysis(result);
      if (result.faceCount === 0) {
        toast({ title: "No face detected", description: "The photo does not contain a detectable face.", variant: "destructive" });
      } else {
        toast({ title: "Analysis complete", description: `${result.faceCount} face(s) detected.` });
      }
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally { setFaceAnalysing(false); }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !farmer) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const { uploadUrl, key } = await getFaceUploadUrl((farmer as any).id, "reference");
      await uploadBlobToS3(uploadUrl, file);
      await saveFaceReference((farmer as any).id, key);
      await qc.invalidateQueries({ queryKey: KEYS.farmer(id) });
      await qc.invalidateQueries({ queryKey: ["face-view-url", key] });
      toast({ title: "Photo updated", description: "Reference photo saved successfully." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2 space-y-5">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
          </div>
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!farmer) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <span>Farmer not found.</span>
        <Link href="/farmers"><Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button></Link>
      </div>
    );
  }

  const f = farmer as any;
  const status = f.status as string;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/farmers">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate">
              {f.beneficiaryType === "group"
                ? (f.farmerGroup || `${f.firstName} ${f.lastName}`)
                : `${f.firstName} ${f.lastName}`}
            </h1>
            {f.beneficiaryType === "group" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-medium">
                <Users className="h-3 w-3" /> Group
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{f.farmerCode}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <StatusBadge status={status} />
          {can.editFarmer && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          )}
          {can.approveFarmer && status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50" disabled={actionLoading} onClick={() => setRejectOpen(true)}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
              <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" disabled={actionLoading} onClick={() => setApproveOpen(true)}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 space-y-5">
          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                {f.beneficiaryType === "group" ? (
                  <>
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                    Group Information
                    <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-medium">
                      Group Beneficiary
                    </span>
                  </>
                ) : (
                  <>
                    <User className="h-3.5 w-3.5" />
                    Personal Information
                    <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px] font-medium">
                      Individual
                    </span>
                  </>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              {f.beneficiaryType === "group" ? (
                <>
                  <Field label="Group / Cooperative Name" value={f.farmerGroup} icon={Users} />
                  <Field label="Number of Members"        value={f.groupSize ? String(f.groupSize) : undefined} />
                  <Field label="Contact Person"           value={(f.firstName && f.firstName !== "—") ? `${f.firstName} ${f.lastName}` : undefined} icon={User} />
                  <Field label="Contact Phone"            value={f.phone} icon={Phone} />
                </>
              ) : (
                <>
                  <Field label="Gender"      value={f.gender}     icon={User} />
                  <Field label="Phone"       value={f.phone}      icon={Phone} />
                  <Field label="National ID" value={f.nationalId} icon={IdCard} />
                  <Field label="Date of Birth" value={f.dateOfBirth ? new Date(f.dateOfBirth).toLocaleDateString("en-GB") : undefined} />
                  {f.farmerGroup && <Field label="Farmer Group / Cooperative" value={f.farmerGroup} />}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold">Agricultural Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field label="Value Chain"    value={f.valueChainName} icon={Sprout} />
              <Field label="Farm Size (Ha)" value={f.farmSize?.toString()} />
              <Field label="District"       value={f.districtName}   icon={MapPin} />
              <Field label="Chiefdom"       value={f.chiefdomName} />
              <Field label="Section"        value={f.sectionName} />
              <Field label="Community"      value={f.communityName} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {/* Biometric photo */}
          <Card className="overflow-hidden">
            <div className="relative h-28 bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-950">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_80%_40%,white,transparent)]" />
            </div>
            <CardContent className="px-4 pb-5 pt-0">
              <div className="flex flex-col items-center -mt-14 gap-3">
                {photoLoading ? (
                  <Skeleton className="h-28 w-28 rounded-full ring-4 ring-background" />
                ) : photoSrc ? (
                  <div className="relative">
                    <img
                      src={photoSrc}
                      alt={`${f.firstName} ${f.lastName}`}
                      className="h-28 w-28 rounded-full object-cover ring-4 ring-background shadow-xl border-2 border-emerald-200"
                    />
                    <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
                      <Camera className="h-2.5 w-2.5 text-white" />
                    </span>
                  </div>
                ) : (
                  <div className="h-28 w-28 rounded-full bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center gap-1.5 ring-4 ring-background shadow-md border-2 border-dashed border-slate-200 dark:border-slate-700 text-muted-foreground">
                    <Camera className="h-8 w-8 opacity-25" />
                    <span className="text-[10px] text-center px-2 leading-tight">No photo</span>
                  </div>
                )}

                <div className="text-center space-y-1.5">
                  <p className="text-base font-bold leading-tight">{farmerDisplayName(f)}</p>
                  <p className="text-xs text-muted-foreground font-mono">{f.farmerCode}</p>
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    <StatusBadge status={status} size="sm" />
                    {photoSrc && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-medium">
                        <Camera className="h-2.5 w-2.5" /> Biometric on file
                      </span>
                    )}
                  </div>
                </div>

                {/* Manual photo upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div className="flex gap-1.5 w-full">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs flex-1"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading
                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading…</>
                      : <><Upload className="h-3 w-3 mr-1" /> {photoSrc ? "Replace" : "Upload"}</>
                    }
                  </Button>
                  {photoSrc && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs flex-1"
                      disabled={faceAnalysing}
                      onClick={() => { setFaceAnalysis(null); handleAnalyseFace(); }}
                    >
                      {faceAnalysing
                        ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Analysing…</>
                        : <><ScanFace className="h-3 w-3 mr-1" /> Analyse</>
                      }
                    </Button>
                  )}
                </div>

                {/* Face analysis results panel */}
                {faceAnalysis && faceAnalysis.faceCount === 0 && (
                  <div className="w-full rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-center">
                    <AlertTriangle className="h-4 w-4 text-red-500 mx-auto mb-1" />
                    <p className="text-xs text-red-700 font-medium">No face detected</p>
                    <p className="text-[10px] text-red-600 mt-0.5">Photo may be too blurry, dark, or not contain a face</p>
                  </div>
                )}
                {faceAnalysis && faceAnalysis.faceCount > 0 && (
                  <div className="w-full rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <ScanFace className="h-3 w-3" /> Face Analysis
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      {faceAnalysis.ageRangeLow != null && faceAnalysis.ageRangeHigh != null && (
                        <div className="flex items-center gap-1.5 col-span-2">
                          <User className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Age range:</span>
                          <span className="font-medium">{faceAnalysis.ageRangeLow}–{faceAnalysis.ageRangeHigh} yrs</span>
                        </div>
                      )}
                      {faceAnalysis.gender && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Gender:</span>
                          <span className="font-medium">{faceAnalysis.gender}
                            {faceAnalysis.genderConfidence != null && <span className="text-muted-foreground font-normal"> ({faceAnalysis.genderConfidence.toFixed(0)}%)</span>}
                          </span>
                        </div>
                      )}
                      {faceAnalysis.primaryEmotion && (
                        <div className="flex items-center gap-1.5">
                          <Smile className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Emotion:</span>
                          <span className="font-medium capitalize">{faceAnalysis.primaryEmotion.toLowerCase()}
                            {faceAnalysis.primaryEmotionConfidence != null && <span className="text-muted-foreground font-normal"> ({faceAnalysis.primaryEmotionConfidence.toFixed(0)}%)</span>}
                          </span>
                        </div>
                      )}
                      {faceAnalysis.eyesOpen != null && (
                        <div className="flex items-center gap-1.5">
                          <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Eyes:</span>
                          <span className={`font-medium ${faceAnalysis.eyesOpen ? "text-emerald-700" : "text-amber-600"}`}>
                            {faceAnalysis.eyesOpen ? "Open" : "Closed"}
                          </span>
                        </div>
                      )}
                      {faceAnalysis.smile != null && (
                        <div className="flex items-center gap-1.5">
                          <Star className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">Smile:</span>
                          <span className="font-medium">{faceAnalysis.smile ? "Yes" : "No"}</span>
                        </div>
                      )}
                    </div>
                    {/* Photo quality bar */}
                    {faceAnalysis.faceQuality != null && (
                      <div className="space-y-1 pt-1 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Zap className="h-2.5 w-2.5" />Photo quality</span>
                          <span className={`text-[10px] font-bold ${faceAnalysis.faceQuality >= 70 ? "text-emerald-700" : faceAnalysis.faceQuality >= 40 ? "text-amber-600" : "text-red-600"}`}>
                            {faceAnalysis.faceQuality.toFixed(0)} / 100
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${faceAnalysis.faceQuality >= 70 ? "bg-emerald-500" : faceAnalysis.faceQuality >= 40 ? "bg-amber-400" : "bg-red-500"}`}
                            style={{ width: `${faceAnalysis.faceQuality}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground">
                          <span>Brightness {faceAnalysis.brightness?.toFixed(0) ?? "—"}</span>
                          <span>Sharpness {faceAnalysis.sharpness?.toFixed(0) ?? "—"}</span>
                        </div>
                      </div>
                    )}
                    {f.beneficiaryType !== "group" && (
                      <p className="text-[9px] text-muted-foreground pt-0.5 border-t leading-tight">
                        Analysis via AWS Rekognition — for verification purposes only. Results may not be 100% accurate.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Farmer ID Card with QR */}
          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" /> ID Card & QR Code
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FarmerIdCard
                farmer={{
                  firstName:       f.firstName,
                  lastName:        f.lastName,
                  farmerCode:      f.farmerCode,
                  barcodeToken:    f.barcodeToken,
                  gender:          f.gender,
                  districtName:    f.districtName,
                  chiefdomName:    f.chiefdomName,
                  valueChainName:  f.valueChainName,
                  status:          f.status,
                  phone:           f.phone,
                  beneficiaryType: f.beneficiaryType,
                  farmerGroup:     f.farmerGroup,
                }}
                photoUrl={photoSrc ?? null}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {f && (
        <EditFarmerModal
          open={editOpen}
          farmer={f}
          onClose={() => setEditOpen(false)}
        />
      )}

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Farmer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{farmerDisplayName(f)}</strong> as approved and grant them access to distribution campaigns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-green-700 hover:bg-green-800" onClick={handleApproveConfirm}>Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Farmer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{farmerDisplayName(f)}</strong> as rejected. You can review this decision later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleRejectConfirm}>Reject</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
