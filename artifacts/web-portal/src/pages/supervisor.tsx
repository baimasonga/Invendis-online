import { useState } from "react";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPod, getPodStats, approvePod, overrideFacePod, getPhotoUrl,
  listDispatches, listIncidents, getAlertCounts, KEYS,
} from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ShieldX, ShieldAlert, ShieldCheck, Clock, AlertTriangle, Truck,
  CheckCircle2, MapPin, Flag, UsersRound, RefreshCcw,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const FACE_STYLES: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
  verified:    { cls: "text-emerald-700", icon: ShieldCheck, label: "Verified" },
  failed:      { cls: "text-red-600",     icon: ShieldX,     label: "Failed" },
  override:    { cls: "text-amber-600",   icon: ShieldAlert, label: "Override" },
  noreference: { cls: "text-slate-500",   icon: ShieldAlert, label: "No Reference" },
  noface:      { cls: "text-slate-500",   icon: ShieldX,     label: "No Face" },
  error:       { cls: "text-slate-400",   icon: ShieldAlert, label: "Error" },
};

function FaceStatusPill({ status }: { status?: string }) {
  const key = (status ?? "").toLowerCase().replace(/\s+/g, "");
  const { cls, icon: Icon, label } = FACE_STYLES[key] ?? { cls: "text-slate-400", icon: ShieldAlert, label: status ?? "—" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

function PodPhoto({ photoKey }: { photoKey: string }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ["photo-sv", photoKey],
    queryFn: () => getPhotoUrl(photoKey),
    staleTime: 50 * 60 * 1000,
    enabled: !!photoKey,
  });
  if (isLoading) return <Skeleton className="w-full h-28 rounded-lg" />;
  if (!url) return <div className="h-28 bg-muted rounded-lg flex items-center justify-center text-[10px] text-muted-foreground">Unavailable</div>;
  return <img src={url} className="w-full h-28 object-cover rounded-lg border" alt="PoD photo" />;
}

function StatCard({ label, value, icon: Icon, cls, bg }: { label: string; value: number | undefined; icon: React.ElementType; cls: string; bg: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
          <Icon className={`h-4.5 w-4.5 ${cls}`} />
        </div>
        <div>
          {value === undefined ? <Skeleton className="h-6 w-10 mb-1" /> : <p className="text-2xl font-bold leading-none">{value}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupervisorView() {
  const { user } = useAuth();
  const role = (user?.role ?? "").toLowerCase().replace(/\s+/g, "");
  // Computed before the early return below: React requires every hook on this
  // component to run on every render, so the redirect happens after them.
  const denied = !!user && !["admin", "projectmanager", "districtcoordinator"].includes(role);

  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedPod, setSelectedPod] = useState<any>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const { data: stats } = useQuery({ queryKey: KEYS.podStats(), queryFn: getPodStats });
  const { data: alertData } = useQuery({ queryKey: KEYS.alertCounts(), queryFn: getAlertCounts, refetchInterval: 60_000 });

  const { data: faceFailedData, isLoading: loadingFailed, refetch: refetchFailed } = useQuery({
    queryKey: ["sv-pod-face-failed"],
    queryFn: () => listPod(1, 30, undefined, "Pending", "Failed"),
    refetchInterval: 60_000,
  });

  const { data: dispatchResp, isLoading: loadingDispatches } = useQuery({
    queryKey: ["sv-dispatches-active"],
    queryFn: () => listDispatches(1, 20, undefined, "In Transit"),
    refetchInterval: 30_000,
  });

  const { data: incidentsResp, isLoading: loadingIncidents } = useQuery({
    queryKey: ["sv-incidents-open"],
    queryFn: () => listIncidents(1, 10, "Open"),
    refetchInterval: 60_000,
  });

  const faceFailedRows: any[] = faceFailedData?.data ?? [];
  const dispatches: any[] = (dispatchResp as any)?.data ?? [];
  const incidents: any[] = incidentsResp?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePod(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sv-pod-face-failed"] });
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      await qc.invalidateQueries({ queryKey: KEYS.podStats() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      setSelectedPod(null);
      toast({ title: "PoD approved" });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => overrideFacePod(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sv-pod-face-failed"] });
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      setOverrideOpen(false);
      setOverrideReason("");
      setSelectedPod(null);
      toast({ title: "Face check overridden" });
    },
    onError: (e: any) => toast({ title: "Override failed", description: e.message, variant: "destructive" }),
  });

  if (denied) return <Redirect to="/dashboard" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supervisor View"
        subtitle="Face review queue, active dispatches, and open incidents."
        actions={
          <Button size="sm" variant="outline" onClick={() => refetchFailed()}>
            <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />Refresh
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Face-Failed (Pending)" value={faceFailedRows.length} icon={ShieldX}     cls="text-red-600"     bg="bg-red-50 dark:bg-red-900/20" />
        <StatCard label="Pending PoDs"          value={stats?.pending}         icon={Clock}        cls="text-amber-600"   bg="bg-amber-50 dark:bg-amber-900/20" />
        <StatCard label="Open Incidents"         value={alertData?.openIncidents} icon={AlertTriangle} cls="text-orange-600" bg="bg-orange-50 dark:bg-orange-900/20" />
        <StatCard label="In-Transit Dispatches"  value={dispatches.length}      icon={Truck}        cls="text-blue-600"    bg="bg-blue-50 dark:bg-blue-900/20" />
      </div>

      {/* Face Review Queue */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-red-600" />
            Face Verification Review Queue
            {faceFailedRows.length > 0 && (
              <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {faceFailedRows.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingFailed ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
          ) : faceFailedRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 opacity-30" />
              <p className="text-sm">No pending face-failed PoDs — all clear</p>
            </div>
          ) : (
            <div className="space-y-2">
              {faceFailedRows.map((pod: any) => (
                <button
                  key={pod.id}
                  onClick={() => setSelectedPod(pod)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
                >
                  <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden bg-muted">
                    {pod.photoUrl ? <PodPhoto photoKey={pod.photoUrl} /> : <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">—</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{pod.farmerName ?? "Unknown"}</p>
                      {pod.beneficiaryType === "group" && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 shrink-0">
                          <UsersRound className="h-2.5 w-2.5" />{pod.groupSize ?? "Group"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{pod.podCode}</p>
                    <p className="text-xs text-muted-foreground">{pod.campaignName ?? "—"}</p>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    <FaceStatusPill status={pod.faceStatus} />
                    {pod.faceSimilarity != null && (
                      <p className="text-[10px] text-muted-foreground">{Number(pod.faceSimilarity).toFixed(0)}% match</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Dispatches */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Truck className="h-4 w-4 text-blue-600" />
            Active Dispatches
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingDispatches ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : dispatches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Truck className="h-8 w-8 opacity-30" />
              <p className="text-sm">No in-transit dispatches right now</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dispatches.map((d: any) => {
                const total = d.totalPackages ?? 0;
                const delivered = d.deliveredPackages ?? 0;
                const pct = total > 0 ? Math.round((delivered / total) * 100) : 0;
                return (
                  <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-900/10">
                    <Truck className="h-4 w-4 text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium font-mono">{d.manifestCode ?? `#${d.id}`}</p>
                        <span className="text-xs text-muted-foreground shrink-0">{delivered}/{total} delivered</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{d.warehouseName ?? "—"} → {d.districtName ?? "—"}</p>
                      <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-700 shrink-0">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open Incidents */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            Open Incidents
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loadingIncidents ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <Flag className="h-8 w-8 opacity-30" />
              <p className="text-sm">No open incidents</p>
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc: any) => (
                <div key={inc.id} className="flex items-start gap-3 p-3 rounded-lg border bg-orange-50/50 dark:bg-orange-900/10">
                  <AlertTriangle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{inc.incidentType ?? inc.title ?? "Incident"}</p>
                      <StatusBadge status={inc.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{inc.description ? inc.description.slice(0, 80) + (inc.description.length > 80 ? "…" : "") : "—"}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      {inc.location && <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{inc.location}</span>}
                      <span>{inc.officerName ?? "—"}</span>
                      <span>{inc.createdAt ? new Date(inc.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pod Detail Dialog */}
      <Dialog open={!!selectedPod} onOpenChange={(v) => { if (!v) setSelectedPod(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldX className="h-4 w-4 text-red-600" />
              Face Review — <span className="font-mono text-sm">{selectedPod?.podCode}</span>
            </DialogTitle>
          </DialogHeader>
          {selectedPod && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1 text-center">Delivery Photo</p>
                  {selectedPod.photoUrl ? <PodPhoto photoKey={selectedPod.photoUrl} /> : <div className="h-28 bg-muted rounded-lg flex items-center justify-center text-xs text-muted-foreground">No photo</div>}
                </div>
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1 text-center">Reference Photo</p>
                  {selectedPod.referencePhotoKey ? <PodPhoto photoKey={selectedPod.referencePhotoKey} /> : <div className="h-28 bg-muted rounded-lg flex items-center justify-center text-xs text-muted-foreground">No reference</div>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Farmer</p>
                  <p className="font-medium">{selectedPod.farmerName ?? "—"}</p>
                  <p className="text-xs font-mono text-muted-foreground">{selectedPod.farmerCode}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Campaign</p>
                  <p className="font-medium">{selectedPod.campaignName ?? "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Qty</p><p className="font-bold text-lg leading-none">{selectedPod.quantityDelivered ?? "—"}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Face Check</p>
                  <FaceStatusPill status={selectedPod.faceStatus} />
                  {selectedPod.faceSimilarity != null && <p className="text-[10px] text-muted-foreground">{Number(selectedPod.faceSimilarity).toFixed(0)}% match</p>}
                </div>
                <div>
                  {(selectedPod.farmerLatitude && selectedPod.farmerLongitude) && (
                    <a href={`https://www.google.com/maps?q=${selectedPod.farmerLatitude},${selectedPod.farmerLongitude}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-0.5 mt-3">
                      <MapPin className="h-3 w-3" />View GPS
                    </a>
                  )}
                </div>
              </div>

              {selectedPod.notes && <div><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p className="text-sm bg-muted/50 rounded-lg px-3 py-2">{selectedPod.notes}</p></div>}

              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1 bg-green-700 hover:bg-green-800 text-white"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate(selectedPod.id)}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {approveMutation.isPending ? "Approving…" : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-amber-700 border-amber-300 hover:bg-amber-50"
                  onClick={() => { setOverrideOpen(true); setOverrideReason(""); }}
                >
                  <ShieldAlert className="h-4 w-4 mr-1.5" />Override
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Override Dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Supervisor Override
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Mark this face check as accepted by a supervisor. Provide a reason for the override record.
            </p>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea
                placeholder="e.g. Field officer confirmed identity in person, biometric hardware unavailable…"
                rows={3}
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setOverrideOpen(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                disabled={!overrideReason.trim() || overrideMutation.isPending}
                onClick={() => overrideMutation.mutate({ id: selectedPod!.id, reason: overrideReason })}
              >
                {overrideMutation.isPending ? "Saving…" : "Confirm Override"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
