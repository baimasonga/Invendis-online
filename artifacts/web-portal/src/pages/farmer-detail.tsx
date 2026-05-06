import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFarmer, approveFarmer, rejectFarmer, getFaceViewUrl, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, User, MapPin, Sprout, Hash, Phone, IdCard, CheckCircle2, XCircle, Camera } from "lucide-react";
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

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

  async function handleApprove() {
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
    } finally { setActionLoading(false); }
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
          <h1 className="text-xl font-bold truncate">{f.firstName} {f.lastName}</h1>
          <p className="text-xs text-muted-foreground font-mono">{f.farmerCode}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <StatusBadge status={status} />
          {can.approveFarmer && status === "pending" && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50" disabled={actionLoading} onClick={() => setRejectOpen(true)}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
              </Button>
              <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" disabled={actionLoading} onClick={handleApprove}>
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
              <CardTitle className="text-sm font-semibold">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field label="Gender"      value={f.gender}    icon={User} />
              <Field label="Phone"       value={f.phone}     icon={Phone} />
              <Field label="National ID" value={f.nationalId} icon={IdCard} />
              <Field label="Date of Birth" value={f.dateOfBirth ? new Date(f.dateOfBirth).toLocaleDateString("en-GB") : undefined} />
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
            <div className="relative h-32 bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-950">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_80%_40%,white,transparent)]" />
              <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/20 to-transparent" />
            </div>
            <CardContent className="px-4 pb-5 pt-0">
              <div className="flex flex-col items-center -mt-16 gap-3">
                {photoLoading ? (
                  <Skeleton className="h-32 w-32 rounded-full ring-4 ring-background" />
                ) : photoSrc ? (
                  <div className="relative">
                    <img
                      src={photoSrc}
                      alt={`${f.firstName} ${f.lastName}`}
                      className="h-32 w-32 rounded-full object-cover ring-4 ring-background shadow-xl border-2 border-emerald-200"
                    />
                    <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
                      <Camera className="h-2.5 w-2.5 text-white" />
                    </span>
                  </div>
                ) : (
                  <div className="h-32 w-32 rounded-full bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center gap-1.5 ring-4 ring-background shadow-md border-2 border-dashed border-slate-200 dark:border-slate-700 text-muted-foreground">
                    <Camera className="h-8 w-8 opacity-25" />
                    <span className="text-[10px] text-center px-2 leading-tight">No photo</span>
                  </div>
                )}
                <div className="text-center space-y-1.5">
                  <p className="text-base font-bold leading-tight">{f.firstName} {f.lastName}</p>
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
                  firstName:      f.firstName,
                  lastName:       f.lastName,
                  farmerCode:     f.farmerCode,
                  barcodeToken:   f.barcodeToken,
                  gender:         f.gender,
                  districtName:   f.districtName,
                  chiefdomName:   f.chiefdomName,
                  valueChainName: f.valueChainName,
                  status:         f.status,
                  phone:          f.phone,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Farmer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{f.firstName} {f.lastName}</strong> as rejected. You can review this decision later.
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
