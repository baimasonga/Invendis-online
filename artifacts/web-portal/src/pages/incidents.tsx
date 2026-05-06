import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listIncidents, resolveIncident, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertTriangle, CheckCircle2, Clock, ChevronLeft, ChevronRight,
  MapPin, User, Cpu, ShieldAlert, Package, MessageSquareWarning,
  AlertOctagon, HelpCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const INCIDENT_ICONS: Record<string, React.ElementType> = {
  "Fraud Attempt":    AlertOctagon,
  "System Issue":     Cpu,
  "Farmer Dispute":   MessageSquareWarning,
  "Stock Discrepancy": Package,
  "Safety Concern":   ShieldAlert,
  "Other":            HelpCircle,
};

const STATUS_FILTER_CHIPS = [
  { label: "All",      value: "" },
  { label: "Open",     value: "Open" },
  { label: "Resolved", value: "Resolved" },
];

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Incidents() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: KEYS.incidents(page, statusFilter || undefined),
    queryFn: () => listIncidents(page, limit, statusFilter || undefined),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => resolveIncident(id, notes),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.incidents() });
      toast({ title: "Incident resolved" });
      setResolveOpen(false);
      setSelected(null);
      setResolutionNotes("");
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const openCount = rows.filter((r) => r.status === "Open").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Field Incidents"
        subtitle="Incident reports submitted by field officers."
        badge={
          openCount > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
              <AlertTriangle className="h-2.5 w-2.5" />
              {openCount} open
            </span>
          ) : undefined
        }
      />

      <Card>
        <div className="px-4 pt-3 pb-2 flex items-center gap-1.5 border-b flex-wrap">
          {STATUS_FILTER_CHIPS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => { setStatusFilter(value); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${statusFilter === value ? "bg-green-700 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {label}
            </button>
          ))}
          {!isLoading && (
            <span className="text-xs text-muted-foreground ml-auto">{total.toLocaleString()} records</span>
          )}
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[130px]">Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Officer</TableHead>
                <TableHead className="hidden lg:table-cell">Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right hidden sm:table-cell">Reported</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden sm:table-cell pr-4"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : rows.length > 0
                ? rows.map((inc) => {
                    const Icon = INCIDENT_ICONS[inc.type] ?? HelpCircle;
                    return (
                      <TableRow
                        key={inc.id}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() => setSelected(inc)}
                      >
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{inc.incidentCode}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-red-50 flex items-center justify-center shrink-0">
                              <Icon className="h-3.5 w-3.5 text-red-600" />
                            </div>
                            <span className="text-sm font-medium">{inc.type}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex items-center gap-1.5 text-sm">
                            <User className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span>{inc.officerName ?? inc.reportedBy ?? "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {inc.location ? (
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[160px]">{inc.location}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={inc.status} />
                        </TableCell>
                        <TableCell className="pr-4 text-right text-xs text-muted-foreground hidden sm:table-cell">
                          {timeAgo(inc.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <AlertTriangle className="h-8 w-8 opacity-30" />
                          <span className="text-sm">
                            {statusFilter ? `No ${statusFilter.toLowerCase()} incidents` : "No incidents reported yet"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>

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
        </CardContent>
      </Card>

      {/* Incident detail dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => { if (!v) setSelected(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && (() => { const Icon = INCIDENT_ICONS[selected.type] ?? HelpCircle; return <Icon className="h-4 w-4 text-red-600" />; })()}
              <span>{selected?.type}</span>
              <span className="font-mono text-xs text-muted-foreground">#{selected?.incidentCode}</span>
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <StatusBadge status={selected.status} />
                <span className="text-xs text-muted-foreground">{timeAgo(selected.createdAt)}</span>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1">Description</p>
                <p className="text-sm bg-muted/40 rounded-lg px-3 py-2 leading-relaxed">{selected.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Reported by</p>
                  <p className="font-medium">{selected.officerName ?? selected.reportedBy ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Location</p>
                  <p className="font-medium">{selected.location || "Not specified"}</p>
                </div>
              </div>

              {(selected.latitude && selected.longitude) && (
                <a
                  href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-blue-600 hover:underline"
                >
                  <MapPin className="h-3 w-3" />
                  {Number(selected.latitude).toFixed(5)}, {Number(selected.longitude).toFixed(5)} — View on map
                </a>
              )}

              {selected.resolutionNotes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Resolution Notes</p>
                  <p className="text-sm bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 text-emerald-800 dark:text-emerald-300">{selected.resolutionNotes}</p>
                </div>
              )}

              {selected.status === "Open" && (
                <Button
                  className="w-full bg-green-700 hover:bg-green-800 text-white"
                  onClick={() => setResolveOpen(true)}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Mark as Resolved
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve dialog */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resolve Incident</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Optionally add resolution notes before marking this incident as resolved.</p>
            <Textarea
              placeholder="Resolution notes (optional)..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setResolveOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate({ id: selected.id, notes: resolutionNotes })}
            >
              {resolveMutation.isPending ? "Resolving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
