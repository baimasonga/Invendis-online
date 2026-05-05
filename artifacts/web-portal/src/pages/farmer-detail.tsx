import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getFarmer, approveFarmer, rejectFarmer, getFaceViewUrl, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, User, MapPin, Sprout, Hash, Phone, IdCard, CheckCircle2, XCircle, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  pending:  "bg-amber-100  text-amber-800  border border-amber-200",
  rejected: "bg-red-100    text-red-800    border border-red-200",
};

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
    staleTime: 1000 * 60 * 10, // signed URLs last 10 min
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
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600"}`}>
            {status}
          </span>
          {status === "pending" && (
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
              <Field label="Gender"    value={f.gender}    icon={User} />
              <Field label="Phone"     value={f.phone}     icon={Phone} />
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
          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Camera className="h-3.5 w-3.5" /> Biometric Photo
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-2">
              {photoLoading ? (
                <Skeleton className="h-36 w-36 rounded-full" />
              ) : photoSrc ? (
                <img
                  src={photoSrc}
                  alt={`${f.firstName} ${f.lastName}`}
                  className="h-36 w-36 rounded-full object-cover border-2 border-emerald-200 shadow"
                />
              ) : (
                <div className="h-36 w-36 rounded-full bg-slate-100 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-slate-200 text-muted-foreground">
                  <Camera className="h-6 w-6 opacity-40" />
                  <span className="text-[10px] text-center px-2">No photo captured</span>
                </div>
              )}
              {photoSrc && (
                <p className="text-[10px] text-muted-foreground">Reference biometric on file</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold">Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Farmer Code" value={f.farmerCode} icon={Hash} />
              <Field label="Registered" value={f.createdAt ? new Date(f.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : undefined} />
              {f.barcodeToken && (
                <div className="pt-2 border-t text-center">
                  <p className="text-xs text-muted-foreground mb-2">Farmer QR Code</p>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${f.barcodeToken}`}
                    alt="QR Code"
                    className="mx-auto rounded border"
                  />
                </div>
              )}
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
