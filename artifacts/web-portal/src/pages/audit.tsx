import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAuditLogs, type AuditFilters, KEYS } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ShieldAlert, Search, X, Download, RotateCcw, SlidersHorizontal,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

// ── Constants ────────────────────────────────────────────────────────────────

const ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT",
  "DISPATCH", "ARRIVE", "RECEIVE", "ADD_ITEM", "BATCH_APPROVE",
  "LOGIN", "LOGOUT",
];

const MODULES = [
  "Farmers", "Campaigns", "Allocations", "Inventory", "Procurement",
  "Dispatch", "Vehicles", "PoD", "Reconciliation", "Incidents",
  "MasterData", "SystemSettings", "Users", "GPS",
];

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const ACTION_STYLES: Record<string, string> = {
  CREATE:       "bg-emerald-100 text-emerald-800",
  UPDATE:       "bg-blue-100   text-blue-800",
  DELETE:       "bg-red-100    text-red-800",
  APPROVE:      "bg-green-100  text-green-800",
  BATCH_APPROVE:"bg-green-100  text-green-800",
  REJECT:       "bg-orange-100 text-orange-800",
  DISPATCH:     "bg-indigo-100 text-indigo-800",
  ARRIVE:       "bg-teal-100   text-teal-800",
  RECEIVE:      "bg-cyan-100   text-cyan-800",
  ADD_ITEM:     "bg-violet-100 text-violet-800",
  LOGIN:        "bg-slate-100  text-slate-600",
  LOGOUT:       "bg-slate-100  text-slate-600",
};

const MODULE_STYLES: Record<string, string> = {
  farmers:      "bg-green-50  text-green-700",
  campaigns:    "bg-blue-50   text-blue-700",
  allocations:  "bg-sky-50    text-sky-700",
  inventory:    "bg-amber-50  text-amber-700",
  procurement:  "bg-orange-50 text-orange-700",
  dispatch:     "bg-indigo-50 text-indigo-700",
  vehicles:     "bg-purple-50 text-purple-700",
  pod:          "bg-teal-50   text-teal-700",
  reconciliation:"bg-lime-50  text-lime-700",
  incidents:    "bg-red-50    text-red-700",
  masterdata:   "bg-slate-50  text-slate-600",
  systemsettings:"bg-slate-50 text-slate-600",
  users:        "bg-pink-50   text-pink-700",
  gps:          "bg-cyan-50   text-cyan-700",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_STYLES[action?.toUpperCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${cls}`}>
      {action}
    </span>
  );
}

function ModuleBadge({ module: mod }: { module: string }) {
  const cls = MODULE_STYLES[mod?.toLowerCase()] ?? "bg-slate-50 text-slate-500";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${cls}`}>
      {mod}
    </span>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function exportCsv(rows: any[]) {
  const headers = ["Timestamp", "Action", "Module", "User", "Description", "Entity Type", "Entity ID", "IP Address"];
  const lines = [
    headers.join(","),
    ...rows.map(r => [
      new Date(r.createdAt).toISOString(),
      r.action,
      r.module,
      r.username ?? "System",
      `"${(r.description ?? "").replace(/"/g, '""')}"`,
      r.entityType ?? "",
      r.entityId ?? "",
      r.ipAddress ?? "",
    ].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Pagination component ─────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onChange(1)}>
        <ChevronsLeft className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "ghost"}
            size="icon"
            className={`h-7 w-7 text-xs ${p === page ? "bg-green-700 hover:bg-green-800 text-white" : ""}`}
            onClick={() => onChange(p as number)}
          >
            {p}
          </Button>
        )
      )}
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => onChange(totalPages)}>
        <ChevronsRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: AuditFilters = { search: "", action: "", module: "", fromDate: "", toDate: "" };

export default function AuditLogs() {
  const [page, setPage]       = useState(1);
  const [limit, setLimit]     = useState(50);
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [search, setSearch]   = useState("");  // controlled input, debounced into filters

  // debounce search input → filters.search
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, search }));
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const activeFilters = [
    filters.action   && { label: `Action: ${filters.action}`,   clear: () => setFilter("action", "") },
    filters.module   && { label: `Module: ${filters.module}`,   clear: () => setFilter("module", "") },
    filters.fromDate && { label: `From: ${filters.fromDate}`,   clear: () => setFilter("fromDate", "") },
    filters.toDate   && { label: `To: ${filters.toDate}`,       clear: () => setFilter("toDate", "") },
    filters.search   && { label: `Search: "${filters.search}"`, clear: () => { setSearch(""); setFilters(f => ({ ...f, search: "" })); } },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  function setFilter(key: keyof AuditFilters, value: string) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  }

  function resetAll() {
    setFilters(EMPTY_FILTERS);
    setSearch("");
    setPage(1);
  }

  const { data: logsData, isLoading, isFetching } = useQuery({
    queryKey: KEYS.auditLogs(page, { ...filters, limit }),
    queryFn: () => listAuditLogs(page, limit, filters),
    placeholderData: (prev) => prev,
  });

  const rows       = logsData?.data ?? [];
  const total      = logsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from       = total === 0 ? 0 : (page - 1) * limit + 1;
  const to         = Math.min(page * limit, total);

  async function handleExport() {
    // fetch all matching rows (up to 5000) for export
    const all = await listAuditLogs(1, 5000, filters);
    exportCsv(all.data);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Logs"
        subtitle="Full system event trail for compliance and debugging."
        badge={!isLoading && total > 0 ? (
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
            {total.toLocaleString()} events
          </span>
        ) : undefined}
        actions={
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        }
      />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap gap-2 items-end">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search description…"
                className="pl-8 h-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); setFilters(f => ({ ...f, search: "" })); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Action filter */}
            <Select value={filters.action ?? ""} onValueChange={v => setFilter("action", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs w-[130px]">
                <SlidersHorizontal className="h-3 w-3 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Module filter */}
            <Select value={filters.module ?? ""} onValueChange={v => setFilter("module", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs w-[140px]">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={filters.fromDate ?? ""}
                onChange={e => setFilter("fromDate", e.target.value)}
                className="h-8 text-xs w-[130px]"
                title="From date"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="date"
                value={filters.toDate ?? ""}
                onChange={e => setFilter("toDate", e.target.value)}
                className="h-8 text-xs w-[130px]"
                title="To date"
              />
            </div>

            {/* Page size */}
            <Select value={String(limit)} onValueChange={v => { setLimit(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(n => (
                  <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Reset */}
            {activeFilters.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={resetAll}>
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
            )}
          </div>

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t">
              {activeFilters.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] gap-1 pr-1 font-normal">
                  {f.label}
                  <button onClick={f.clear} className="hover:text-destructive ml-0.5">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className={isFetching && !isLoading ? "opacity-75 transition-opacity" : ""}>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[155px]">Timestamp</TableHead>
                <TableHead className="w-[110px]">Action</TableHead>
                <TableHead className="hidden md:table-cell w-[115px]">Module</TableHead>
                <TableHead className="hidden sm:table-cell w-[130px]">User</TableHead>
                <TableHead className="pr-4">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-14 mt-1" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 rounded" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-4 w-52" /></TableCell>
                    </TableRow>
                  ))
                : rows.length > 0
                ? rows.map((log: any) => (
                    <TableRow key={log.id} className="hover:bg-muted/40 align-top">
                      <TableCell className="pl-4 py-2.5">
                        <p className="text-xs tabular-nums text-foreground">
                          {new Date(log.createdAt).toLocaleString("en-GB", {
                            day: "numeric", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(log.createdAt)}</p>
                      </TableCell>
                      <TableCell className="py-2.5"><ActionBadge action={log.action} /></TableCell>
                      <TableCell className="hidden md:table-cell py-2.5"><ModuleBadge module={log.module} /></TableCell>
                      <TableCell className="hidden sm:table-cell py-2.5 text-xs text-muted-foreground">
                        {log.username ?? "System"}
                      </TableCell>
                      <TableCell className="pr-4 py-2.5 text-xs text-foreground/80 max-w-xs" title={log.description}>
                        {log.description}
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-40 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ShieldAlert className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No audit logs found</span>
                          {activeFilters.length > 0 && (
                            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={resetAll}>
                              <RotateCcw className="h-3 w-3" /> Clear filters
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>

          {/* ── Pagination footer ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
            <span>
              {total === 0
                ? "No results"
                : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} events`}
            </span>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
