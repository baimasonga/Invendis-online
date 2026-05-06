import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listPod, getPodStats, approvePod, flagPodException, batchApprovePods, getPhotoUrl, KEYS } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft, ChevronRight, ClipboardCheck, CheckCircle2, Clock,
  AlertCircle, Plus, MapPin, ShieldCheck, ShieldX, ShieldAlert,
  ListChecks, Flag, BadgeCheck,
} from "lucide-react";
import { SubmitPodModal } from "@/components/modals/SubmitPodModal";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const FACE_STYLES: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
  verified:     { cls: "text-emerald-700", icon: ShieldCheck, label: "Verified" },
  failed:       { cls: "text-red-600",     icon: ShieldX,     label: "Failed" },
  override:     { cls: "text-amber-600",   icon: ShieldAlert, label: "Override" },
  noreference:  { cls: "text-slate-500",   icon: ShieldAlert, label: "No Reference" },
  noface:       { cls: "text-slate-500",   icon: ShieldX,     label: "No Face" },
  error:        { cls: "text-slate-400",   icon: ShieldAlert, label: "Error" },
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

function OtpPill({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  if (s === "verified") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />Verified</span>;
  if (s === "bypassed") return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><ShieldAlert className="h-3 w-3" />Bypassed</span>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_FILTER_CHIPS = [
  { label: "All",       value: "" },
  { label: "Pending",   value: "Pending" },
  { label: "Verified",  value: "Verified" },
  { label: "Exception", value: "Exception" },
];

function PodDetailPhoto({ photoKey }: { photoKey: string }) {
  const { data: url, isLoading } = useQuery({
    queryKey: ["photo-url", photoKey],
    queryFn: () => getPhotoUrl(photoKey),
    staleTime: 50 * 60 * 1000,
    enabled: !!photoKey,
  });
  if (isLoading) return <Skeleton className="w-full h-40 rounded-lg" />;
  if (!url) return <div className="w-full h-40 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">Photo unavailable</div>;
  return <img src={url} alt="Delivery photo" className="w-full h-40 object-cover rounded-lg border" />;
}

// ── Review Queue ──────────────────────────────────────────────────────────────

function ReviewQueue() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedPod, setSelectedPod] = useState<any>(null);
  const limit = 25;

  const { data: podData, isLoading } = useQuery({
    queryKey: KEYS.pod(page, undefined, "Pending"),
    queryFn: () => listPod(page, limit, undefined, "Pending"),
  });

  const rows: any[] = podData?.data ?? [];
  const total = podData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const allIds = rows.map((r) => r.id);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = allIds.some((id) => selected.has(id));

  function toggleAll() {
    if (allChecked) {
      setSelected((s) => { const n = new Set(s); allIds.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); allIds.forEach((id) => n.add(id)); return n; });
    }
  }

  function toggle(id: number) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePod(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      await qc.invalidateQueries({ queryKey: KEYS.podStats() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      setSelectedPod(null);
    },
  });

  const flagMutation = useMutation({
    mutationFn: (id: number) => flagPodException(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      await qc.invalidateQueries({ queryKey: KEYS.podStats() });
    },
  });

  const batchMutation = useMutation({
    mutationFn: (ids: number[]) => batchApprovePods(ids),
    onSuccess: async (_, ids) => {
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      await qc.invalidateQueries({ queryKey: KEYS.podStats() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      setSelected(new Set());
      toast({ title: `${ids.length} PoD${ids.length !== 1 ? "s" : ""} approved` });
    },
    onError: (err: any) => toast({ title: "Batch approve failed", description: err.message, variant: "destructive" }),
  });

  const selectedArr = [...selected];

  return (
    <>
      <Card>
        {/* Toolbar */}
        <div className="px-4 py-3 flex items-center gap-3 border-b flex-wrap">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-green-700" />
            <span className="text-sm font-semibold">
              {isLoading ? "…" : total} pending {total === 1 ? "record" : "records"}
            </span>
          </div>
          {selectedArr.length > 0 && (
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <span className="text-xs text-muted-foreground">{selectedArr.length} selected</span>
              <Button
                size="sm"
                className="h-7 px-3 text-xs bg-green-700 hover:bg-green-800 text-white"
                disabled={batchMutation.isPending}
                onClick={() => batchMutation.mutate(selectedArr)}
              >
                <BadgeCheck className="h-3.5 w-3.5 mr-1.5" />
                {batchMutation.isPending ? "Approving…" : `Approve ${selectedArr.length}`}
              </Button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allChecked}
                    data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-[110px]">PoD</TableHead>
                <TableHead>Farmer</TableHead>
                <TableHead className="hidden md:table-cell">OTP</TableHead>
                <TableHead>Face Check</TableHead>
                <TableHead className="hidden sm:table-cell">GPS</TableHead>
                <TableHead className="hidden lg:table-cell">Submitted</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-4 rounded" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-7 w-28 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : rows.length === 0
                ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-40 text-center">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <ClipboardCheck className="h-10 w-10 opacity-20" />
                          <div>
                            <p className="text-sm font-medium">All caught up</p>
                            <p className="text-xs mt-0.5">No pending PoDs awaiting review</p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                : rows.map((pod) => {
                    const faceKey = (pod.faceStatus ?? "").toLowerCase().replace(/\s+/g, "");
                    const needsAttention = faceKey === "failed" || faceKey === "noface";
                    const busy = approveMutation.isPending || flagMutation.isPending;
                    return (
                      <TableRow
                        key={pod.id}
                        className={`hover:bg-muted/40 cursor-pointer ${needsAttention ? "bg-red-50/40 dark:bg-red-900/5" : ""}`}
                        onClick={() => setSelectedPod(pod)}
                      >
                        <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(pod.id)}
                            onCheckedChange={() => toggle(pod.id)}
                            aria-label={`Select PoD ${pod.podCode}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{pod.podCode}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium leading-tight">{pod.farmerName ?? "—"}</p>
                          <p className="text-xs text-muted-foreground font-mono">{pod.farmerCode}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <OtpPill status={pod.otpStatus} />
                        </TableCell>
                        <TableCell>
                          <FaceStatusPill status={pod.faceStatus} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {pod.farmerLatitude
                            ? <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium"><MapPin className="h-3 w-3" />Yes</span>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {pod.submittedAt ? timeAgo(pod.submittedAt) : pod.createdAt ? timeAgo(pod.createdAt) : "—"}
                        </TableCell>
                        <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-xs text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                              disabled={busy}
                              onClick={() => approveMutation.mutate(pod.id, {
                                onSuccess: () => toast({ title: "PoD approved" }),
                                onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                              })}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-800 hover:bg-red-50"
                              disabled={busy}
                              onClick={() => flagMutation.mutate(pod.id, {
                                onSuccess: () => toast({ title: "PoD flagged as exception" }),
                                onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                              })}
                            >
                              <Flag className="h-3 w-3 mr-1" />Flag
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </div>

        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
            <span>Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!selectedPod} onOpenChange={(v) => { if (!v) setSelectedPod(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-green-700" />
              <span className="font-mono text-sm">{selectedPod?.podCode}</span>
              {selectedPod && <StatusBadge status={selectedPod.status} />}
            </DialogTitle>
          </DialogHeader>
          {selectedPod && (
            <div className="space-y-4">
              {selectedPod.photoUrl
                ? <PodDetailPhoto photoKey={selectedPod.photoUrl} />
                : <div className="w-full h-32 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">No delivery photo</div>}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Farmer</p><p className="font-medium">{selectedPod.farmerName ?? "—"}</p><p className="text-xs text-muted-foreground font-mono">{selectedPod.farmerCode}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Campaign</p><p className="font-medium">{selectedPod.campaignName ?? "—"}</p></div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Qty</p><p className="font-semibold text-lg leading-none">{selectedPod.quantityDelivered ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">OTP</p><OtpPill status={selectedPod.otpStatus} /></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Face</p><FaceStatusPill status={selectedPod.faceStatus} /></div>
              </div>
              {(selectedPod.farmerLatitude && selectedPod.farmerLongitude) ? (
                <a href={`https://www.google.com/maps?q=${selectedPod.farmerLatitude},${selectedPod.farmerLongitude}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {Number(selectedPod.farmerLatitude).toFixed(5)}, {Number(selectedPod.farmerLongitude).toFixed(5)} — View on map
                </a>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />No GPS</div>
              )}
              {selectedPod.notes && <div><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p className="text-sm bg-muted/50 rounded-lg px-3 py-2">{selectedPod.notes}</p></div>}
              {selectedPod.status === "Pending" && (
                <div className="flex gap-2 pt-1">
                  <Button
                    className="flex-1 bg-green-700 hover:bg-green-800 text-white"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(selectedPod.id, {
                      onSuccess: () => { toast({ title: "PoD approved" }); setSelectedPod(null); },
                      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                    })}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {approveMutation.isPending ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-red-600 border-red-200 hover:bg-red-50"
                    disabled={flagMutation.isPending}
                    onClick={() => flagMutation.mutate(selectedPod.id, {
                      onSuccess: () => { toast({ title: "Flagged as exception" }); setSelectedPod(null); },
                      onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
                    })}
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    {flagMutation.isPending ? "Flagging…" : "Flag Exception"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main PoD Page ─────────────────────────────────────────────────────────────

export default function ProofOfDelivery() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [podOpen, setPodOpen] = useState(false);
  const [selectedPod, setSelectedPod] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"list" | "review">("list");
  const limit = 20;

  const { data: podData, isLoading } = useQuery({
    queryKey: KEYS.pod(page, undefined, statusFilter || undefined),
    queryFn: () => listPod(page, limit, undefined, statusFilter || undefined),
    enabled: view === "list",
  });
  const { data: stats } = useQuery({
    queryKey: KEYS.podStats(),
    queryFn: getPodStats,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvePod(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.pod() });
      await qc.invalidateQueries({ queryKey: KEYS.podStats() });
      await qc.invalidateQueries({ queryKey: KEYS.alertCounts() });
      toast({ title: "PoD approved" });
      setSelectedPod(null);
    },
    onError: (err: any) => toast({ title: "Approve failed", description: err.message, variant: "destructive" }),
  });

  const total = podData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Proof of Delivery"
        subtitle="Delivery verifications and exception management."
        badge={stats?.pending ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
            <Clock className="h-2.5 w-2.5" /> {stats.pending} pending
          </span>
        ) : undefined}
        actions={
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setPodOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Record Delivery
          </Button>
        }
      />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{stats.verified ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Verified</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{stats.pending ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertCircle className="h-4 w-4 text-red-700 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{stats.exception ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Exceptions</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-1 border rounded-lg p-0.5 w-fit bg-muted/50">
        <button
          onClick={() => setView("list")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> All Records
        </button>
        <button
          onClick={() => setView("review")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === "review" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ListChecks className="h-3.5 w-3.5" /> Review Queue
          {(stats?.pending ?? 0) > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold">
              {stats!.pending}
            </span>
          )}
        </button>
      </div>

      {view === "review" ? (
        <ReviewQueue />
      ) : (
        <Card>
          {/* Status filter chips */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 border-b">
            {STATUS_FILTER_CHIPS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => { setStatusFilter(value); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === value
                    ? "bg-green-700 text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
            {!isLoading && (
              <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} records</span>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4 w-[130px]">PoD Code</TableHead>
                  <TableHead>Farmer</TableHead>
                  <TableHead className="hidden md:table-cell">Campaign</TableHead>
                  <TableHead className="hidden lg:table-cell">Face Check</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right hidden md:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                        <TableCell className="hidden md:table-cell pr-4"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  : podData?.data && podData.data.length > 0
                  ? podData.data.map((pod) => (
                      <TableRow
                        key={pod.id}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() => setSelectedPod(pod)}
                      >
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{pod.podCode}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{pod.farmerName}</p>
                          <p className="text-xs text-muted-foreground">{pod.farmerCode}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{pod.campaignName ?? "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <FaceStatusPill status={pod.faceStatus} />
                        </TableCell>
                        <TableCell><StatusBadge status={pod.status} /></TableCell>
                        <TableCell className="hidden md:table-cell pr-4 text-right text-xs text-muted-foreground">
                          {new Date(pod.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </TableCell>
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={6} className="h-32 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ClipboardCheck className="h-8 w-8 opacity-30" />
                            <span className="text-sm">No delivery records yet</span>
                            <Button size="sm" variant="outline" onClick={() => setPodOpen(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Record first delivery
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
              </TableBody>
            </Table>
          </div>

          {total > limit && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Detail dialog (list view) */}
      <Dialog open={!!selectedPod} onOpenChange={(v) => { if (!v) setSelectedPod(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-green-700" />
              <span className="font-mono text-sm">{selectedPod?.podCode}</span>
              {selectedPod && <StatusBadge status={selectedPod.status} />}
            </DialogTitle>
          </DialogHeader>
          {selectedPod && (
            <div className="space-y-4">
              {selectedPod.photoUrl
                ? <PodDetailPhoto photoKey={selectedPod.photoUrl} />
                : <div className="w-full h-32 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">No delivery photo</div>}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Farmer</p><p className="font-medium">{selectedPod.farmerName ?? "—"}</p><p className="text-xs text-muted-foreground font-mono">{selectedPod.farmerCode}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">Campaign</p><p className="font-medium">{selectedPod.campaignName ?? "—"}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-muted-foreground mb-0.5">Quantity Delivered</p><p className="font-semibold text-lg leading-none">{selectedPod.quantityDelivered ?? "—"}</p></div>
                <div><p className="text-xs text-muted-foreground mb-0.5">OTP</p><OtpPill status={selectedPod.otpStatus} /></div>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50 text-sm">
                <span className="text-xs text-muted-foreground">Face Verification</span>
                <FaceStatusPill status={selectedPod.faceStatus} />
              </div>
              {(selectedPod.farmerLatitude && selectedPod.farmerLongitude) ? (
                <a href={`https://www.google.com/maps?q=${selectedPod.farmerLatitude},${selectedPod.farmerLongitude}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {Number(selectedPod.farmerLatitude).toFixed(5)}, {Number(selectedPod.farmerLongitude).toFixed(5)} — View on map
                </a>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" /> No GPS coordinates</div>
              )}
              {selectedPod.notes && <div><p className="text-xs text-muted-foreground mb-0.5">Notes</p><p className="text-sm bg-muted/50 rounded-lg px-3 py-2">{selectedPod.notes}</p></div>}
              <p className="text-[11px] text-muted-foreground">
                Submitted {selectedPod.submittedAt
                  ? new Date(selectedPod.submittedAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                  : "—"}
              </p>
              {selectedPod.status === "Pending" && (
                <Button
                  className="w-full bg-green-700 hover:bg-green-800 text-white"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate(selectedPod.id)}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {approveMutation.isPending ? "Approving…" : "Approve Delivery"}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SubmitPodModal open={podOpen} onClose={() => setPodOpen(false)} />
    </div>
  );
}
