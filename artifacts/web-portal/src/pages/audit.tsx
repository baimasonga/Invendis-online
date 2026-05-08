import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listAuditLogs, getAuditStats, type AuditFilters, type AuditStats, KEYS,
} from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTip,
  ResponsiveContainer, AreaChart, Area, CartesianGrid,
} from "recharts";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ShieldAlert, Search, X, Download, RotateCcw, SlidersHorizontal,
  Shield, ShieldCheck, AlertTriangle, Zap, Clock, Trash2,
  Settings2, ThumbsDown, Activity, Users, TrendingUp,
  ChevronDown, ChevronUp, Eye, EyeOff,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

// ── Constants ────────────────────────────────────────────────────────────────

const ACTIONS = [
  "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT",
  "DISPATCH", "ARRIVE", "RECEIVE", "ADD_ITEM", "BATCH_APPROVE",
  "LOGIN", "LOGOUT", "LINK", "UNLINK",
];

const MODULES = [
  "Farmers", "Campaigns", "Allocations", "Inventory", "Procurement",
  "Dispatch", "Vehicles", "PoD", "Reconciliation", "Incidents",
  "MasterData", "SystemSettings", "Users", "GPS",
];

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const ACTION_STYLES: Record<string, string> = {
  CREATE:        "bg-emerald-100 text-emerald-800",
  UPDATE:        "bg-blue-100   text-blue-800",
  DELETE:        "bg-red-100    text-red-800",
  APPROVE:       "bg-green-100  text-green-800",
  BATCH_APPROVE: "bg-green-100  text-green-800",
  REJECT:        "bg-orange-100 text-orange-800",
  DISPATCH:      "bg-indigo-100 text-indigo-800",
  ARRIVE:        "bg-teal-100   text-teal-800",
  RECEIVE:       "bg-cyan-100   text-cyan-800",
  ADD_ITEM:      "bg-violet-100 text-violet-800",
  LOGIN:         "bg-slate-100  text-slate-600",
  LOGOUT:        "bg-slate-100  text-slate-600",
  LINK:          "bg-cyan-100   text-cyan-800",
  UNLINK:        "bg-rose-100   text-rose-800",
};

const MODULE_STYLES: Record<string, string> = {
  farmers:       "bg-green-50  text-green-700",
  campaigns:     "bg-blue-50   text-blue-700",
  allocations:   "bg-sky-50    text-sky-700",
  inventory:     "bg-amber-50  text-amber-700",
  procurement:   "bg-orange-50 text-orange-700",
  dispatch:      "bg-indigo-50 text-indigo-700",
  vehicles:      "bg-purple-50 text-purple-700",
  pod:           "bg-teal-50   text-teal-700",
  reconciliation:"bg-lime-50   text-lime-700",
  incidents:     "bg-red-50    text-red-700",
  masterdata:    "bg-slate-50  text-slate-600",
  systemsettings:"bg-slate-50  text-slate-600",
  users:         "bg-pink-50   text-pink-700",
  gps:           "bg-cyan-50   text-cyan-700",
};

const ACTION_CHART_COLORS: Record<string, string> = {
  CREATE: "#10b981", UPDATE: "#3b82f6", DELETE: "#ef4444",
  APPROVE: "#22c55e", REJECT: "#f97316", DISPATCH: "#6366f1",
  BATCH_APPROVE: "#16a34a", LOGIN: "#94a3b8", LOGOUT: "#94a3b8",
  LINK: "#0891b2", UNLINK: "#e11d48",
};

// ── SIEM Anomaly Engine ───────────────────────────────────────────────────────

export type SiemAlert = {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  title: string;
  description: string;
  affectedIds: number[];
  icon: React.ElementType;
};

function detectAnomalies(logs: any[]): SiemAlert[] {
  if (!logs.length) return [];
  const alerts: SiemAlert[] = [];

  // Rule 1 — Off-hours activity (22:00–06:00) by non-System users
  const offHours = logs.filter(l => {
    const h = new Date(l.createdAt).getHours();
    return (h >= 22 || h < 6) && l.username && l.username !== "System";
  });
  if (offHours.length > 0) {
    const sensitiveActions = ["DELETE", "APPROVE", "REJECT", "UPDATE"];
    const hasSensitive = offHours.some(l => sensitiveActions.includes(l.action?.toUpperCase()));
    const who = [...new Set(offHours.map((l: any) => l.username))].join(", ");
    alerts.push({
      id: "off-hours",
      severity: hasSensitive ? "HIGH" : "MEDIUM",
      category: "Unusual Hours",
      icon: Clock,
      title: `${offHours.length} event${offHours.length > 1 ? "s" : ""} outside business hours`,
      description: `Activity detected between 22:00–06:00 by: ${who}`,
      affectedIds: offHours.map((l: any) => l.id),
    });
  }

  // Rule 2 — Burst activity: same user >8 events within 5 minutes
  const byUser: Record<string, { ts: number; id: number }[]> = {};
  for (const l of logs) {
    const u = l.username ?? "System";
    if (u === "System") continue;
    if (!byUser[u]) byUser[u] = [];
    byUser[u].push({ ts: new Date(l.createdAt).getTime(), id: l.id });
  }
  for (const [user, entries] of Object.entries(byUser)) {
    entries.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i <= entries.length - 8; i++) {
      const window = entries[i].ts + 5 * 60_000;
      const cluster = entries.filter(e => e.ts >= entries[i].ts && e.ts <= window);
      if (cluster.length >= 8) {
        alerts.push({
          id: `burst-${user}`,
          severity: "HIGH",
          category: "Burst Activity",
          icon: Zap,
          title: `${cluster.length} events in 5 minutes by "${user}"`,
          description: "Unusually rapid event generation — possible automation or unauthorized access",
          affectedIds: cluster.map(e => e.id),
        });
        break;
      }
    }
  }

  // Rule 3 — DELETE cluster: ≥3 DELETE events in any 15-minute window
  const deletes = logs
    .filter(l => l.action?.toUpperCase() === "DELETE")
    .map(l => ({ ts: new Date(l.createdAt).getTime(), id: l.id }))
    .sort((a, b) => a.ts - b.ts);
  if (deletes.length >= 2) {
    for (let i = 0; i < deletes.length; i++) {
      const win = deletes[i].ts + 15 * 60_000;
      const cluster = deletes.filter(d => d.ts >= deletes[i].ts && d.ts <= win);
      if (cluster.length >= 2) {
        alerts.push({
          id: "delete-cluster",
          severity: "HIGH",
          category: "Mass Delete",
          icon: Trash2,
          title: `${cluster.length} DELETE operations in 15 minutes`,
          description: "Potential data destruction — multiple deletion events in rapid succession",
          affectedIds: cluster.map(d => d.id),
        });
        break;
      }
    }
  }

  // Rule 4 — High REJECT rate: ≥4 REJECT events in the dataset
  const rejects = logs.filter(l => l.action?.toUpperCase() === "REJECT");
  if (rejects.length >= 4) {
    alerts.push({
      id: "high-reject-rate",
      severity: "MEDIUM",
      category: "Policy Anomaly",
      icon: ThumbsDown,
      title: `${rejects.length} REJECT actions detected`,
      description: "Elevated rejection rate may indicate workflow irregularities or policy conflicts",
      affectedIds: rejects.map((l: any) => l.id),
    });
  }

  // Rule 5 — System settings changes
  const sysSettings = logs.filter(l =>
    l.module?.toLowerCase() === "systemsettings" ||
    l.module?.toLowerCase() === "system_settings"
  );
  if (sysSettings.length > 0) {
    alerts.push({
      id: "system-settings-change",
      severity: "MEDIUM",
      category: "Config Change",
      icon: Settings2,
      title: `${sysSettings.length} system configuration change${sysSettings.length > 1 ? "s" : ""}`,
      description: "System defaults modified — verify changes are authorised and intended",
      affectedIds: sysSettings.map((l: any) => l.id),
    });
  }

  return alerts;
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
      r.action, r.module,
      r.username ?? "System",
      `"${(r.description ?? "").replace(/"/g, '""')}"`,
      r.entityType ?? "", r.entityId ?? "", r.ipAddress ?? "",
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

// ── Stats Panel ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <div className={`mt-0.5 p-2 rounded-md ${accent}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
        <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function StatsPanel({ stats, loading }: { stats: AuditStats | undefined; loading: boolean }) {
  const topAction = stats?.byAction[0];
  const topModule = stats?.byModule[0];
  // Show only last 14 days in the trend chart
  const trendData = stats?.byDay.slice(-14) ?? [];

  // Format date for X axis: "5 May" style
  function fmtDay(d: string) {
    const [, m, day] = d.split("-");
    const months = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${parseInt(day)} ${months[parseInt(m)]}`;
  }

  return (
    <div className="space-y-3">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 rounded-lg border bg-card space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Total Events (30d)"
              value={(stats?.totalEvents ?? 0).toLocaleString()}
              icon={Activity}
              accent="bg-blue-50 text-blue-600"
            />
            <StatCard
              label="Active Users (30d)"
              value={stats?.uniqueUsers ?? 0}
              sub={stats?.byUser[0] ? `Top: ${stats.byUser[0].username} (${stats.byUser[0].count})` : undefined}
              icon={Users}
              accent="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              label="Top Action"
              value={topAction?.count ?? 0}
              sub={topAction?.action ?? "—"}
              icon={TrendingUp}
              accent="bg-violet-50 text-violet-600"
            />
            <StatCard
              label="Top Module"
              value={topModule?.count ?? 0}
              sub={topModule?.module ?? "—"}
              icon={Shield}
              accent="bg-amber-50 text-amber-600"
            />
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Action distribution */}
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Events by Action (30d)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {loading ? (
              <Skeleton className="h-36 w-full rounded" />
            ) : stats && stats.byAction.length > 0 ? (
              <ResponsiveContainer width="100%" height={144}>
                <BarChart data={stats.byAction} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category" dataKey="action" tick={{ fontSize: 10 }} width={80}
                    tickLine={false} axisLine={false}
                  />
                  <RechartsTip
                    contentStyle={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
                    cursor={{ fill: "hsl(var(--muted))" }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {stats.byAction.map(entry => (
                      <rect
                        key={entry.action}
                        fill={ACTION_CHART_COLORS[entry.action] ?? "#94a3b8"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>

        {/* 14-day trend */}
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              14-Day Activity Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {loading ? (
              <Skeleton className="h-36 w-full rounded" />
            ) : (
              <ResponsiveContainer width="100%" height={144}>
                <AreaChart data={trendData} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#16a34a" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="date" tickFormatter={fmtDay}
                    tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                    interval={Math.floor(trendData.length / 4)}
                  />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={24} />
                  <RechartsTip
                    contentStyle={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
                    labelFormatter={fmtDay}
                  />
                  <Area
                    type="monotone" dataKey="count" stroke="#16a34a" strokeWidth={2}
                    fill="url(#areaGrad)" dot={false} activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── SIEM Alerts Panel ─────────────────────────────────────────────────────────

const SEV_CONFIG = {
  HIGH:   { border: "border-red-200",    bg: "bg-red-50",     icon: "text-red-600",   badge: "bg-red-100 text-red-800",    label: "HIGH" },
  MEDIUM: { border: "border-amber-200",  bg: "bg-amber-50",   icon: "text-amber-600", badge: "bg-amber-100 text-amber-800", label: "MED" },
  LOW:    { border: "border-yellow-200", bg: "bg-yellow-50",  icon: "text-yellow-600",badge: "bg-yellow-100 text-yellow-800",label: "LOW" },
};

function SiemPanel({ alerts, siemScanned, loading }: {
  alerts: SiemAlert[]; siemScanned: number; loading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const highCount   = alerts.filter(a => a.severity === "HIGH").length;
  const medCount    = alerts.filter(a => a.severity === "MEDIUM").length;
  const allClear    = alerts.length === 0;

  return (
    <Card className={`border ${allClear ? "border-emerald-200" : highCount > 0 ? "border-red-200" : "border-amber-200"}`}>
      <CardContent className="px-4 py-3">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md ${allClear ? "bg-emerald-50" : highCount > 0 ? "bg-red-50" : "bg-amber-50"}`}>
            {allClear
              ? <ShieldCheck className="h-4 w-4 text-emerald-600" />
              : <ShieldAlert className={`h-4 w-4 ${highCount > 0 ? "text-red-600" : "text-amber-600"}`} />
            }
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                {allClear ? "Security Overview — All Clear" : `${alerts.length} Anomal${alerts.length > 1 ? "ies" : "y"} Detected`}
              </span>
              {!allClear && (
                <div className="flex items-center gap-1">
                  {highCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800">{highCount} HIGH</span>
                  )}
                  {medCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{medCount} MED</span>
                  )}
                </div>
              )}
              <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">
                {loading ? "Scanning…" : `${siemScanned} events scanned`}
              </span>
            </div>
            {allClear && !loading && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                No anomalies found in the last {siemScanned} events. Rules: off-hours, burst activity, delete clusters, reject rate, config changes.
              </p>
            )}
          </div>
          {!allClear && (
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
        </div>

        {/* Alert cards */}
        {!allClear && expanded && (
          <div className="mt-3 space-y-2">
            {alerts.map(alert => {
              const cfg = SEV_CONFIG[alert.severity];
              const Icon = alert.icon;
              return (
                <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${cfg.border} ${cfg.bg}`}>
                  <div className={`mt-0.5 shrink-0 ${cfg.icon}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>
                        {cfg.label}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        {alert.category}
                      </span>
                    </div>
                    <p className="text-sm font-semibold mt-0.5">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {alert.affectedIds.length} log entr{alert.affectedIds.length > 1 ? "ies" : "y"} highlighted in table below
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

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
            key={p} variant={p === page ? "default" : "ghost"} size="icon"
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
  const [page, setPage]         = useState(1);
  const [limit, setLimit]       = useState(50);
  const [filters, setFilters]   = useState<AuditFilters>(EMPTY_FILTERS);
  const [search, setSearch]     = useState("");
  const [showStats, setShowStats] = useState(true);

  // Debounce search → filters.search
  useEffect(() => {
    const t = setTimeout(() => { setFilters(f => ({ ...f, search })); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const activeFilters = [
    filters.action   && { label: `Action: ${filters.action}`,   clear: () => setFilter("action", "") },
    filters.module   && { label: `Module: ${filters.module}`,   clear: () => setFilter("module", "") },
    filters.fromDate && { label: `From: ${filters.fromDate}`,   clear: () => setFilter("fromDate", "") },
    filters.toDate   && { label: `To: ${filters.toDate}`,       clear: () => setFilter("toDate", "") },
    filters.search   && { label: `"${filters.search}"`,         clear: () => { setSearch(""); setFilters(f => ({ ...f, search: "" })); } },
  ].filter(Boolean) as { label: string; clear: () => void }[];

  function setFilter(key: keyof AuditFilters, value: string) {
    setFilters(f => ({ ...f, [key]: value }));
    setPage(1);
  }

  function resetAll() { setFilters(EMPTY_FILTERS); setSearch(""); setPage(1); }

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: logsData, isLoading, isFetching } = useQuery({
    queryKey: KEYS.auditLogs(page, { ...filters, limit }),
    queryFn: () => listAuditLogs(page, limit, filters),
    placeholderData: (prev) => prev,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: KEYS.auditStats(30),
    queryFn: () => getAuditStats(30),
    staleTime: 5 * 60_000,
  });

  // Fetch recent 300 events for SIEM analysis (unfiltered, separate cache key)
  const { data: siemData, isLoading: siemLoading } = useQuery({
    queryKey: KEYS.auditSiem(),
    queryFn: () => listAuditLogs(1, 300),
    staleTime: 2 * 60_000,
  });

  // Run anomaly detection on SIEM events (memoised)
  const siemAlerts = useMemo(() => detectAnomalies(siemData?.data ?? []), [siemData]);
  const siemScanned = siemData?.data?.length ?? 0;

  // Build highlight map for the table rows
  const alertSeverityById = useMemo(() => {
    const map: Record<number, SiemAlert["severity"]> = {};
    const order: Record<SiemAlert["severity"], number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    for (const alert of siemAlerts) {
      for (const id of alert.affectedIds) {
        if (!map[id] || order[alert.severity] > order[map[id]]) map[id] = alert.severity;
      }
    }
    return map;
  }, [siemAlerts]);

  const rows       = logsData?.data ?? [];
  const total      = logsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from       = total === 0 ? 0 : (page - 1) * limit + 1;
  const to         = Math.min(page * limit, total);

  async function handleExport() {
    const all = await listAuditLogs(1, 5000, filters);
    exportCsv(all.data);
  }

  const ROW_ALERT_CLASS: Record<SiemAlert["severity"], string> = {
    HIGH:   "border-l-2 border-l-red-500   bg-red-50/30",
    MEDIUM: "border-l-2 border-l-amber-400 bg-amber-50/30",
    LOW:    "border-l-2 border-l-yellow-400 bg-yellow-50/20",
  };

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
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline" className="h-8 text-xs gap-1.5"
              onClick={() => setShowStats(s => !s)}
            >
              {showStats ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showStats ? "Hide Stats" : "Show Stats"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* ── Stats Panel ─────────────────────────────────────────────────────── */}
      {showStats && <StatsPanel stats={stats} loading={statsLoading} />}

      {/* ── SIEM Panel ──────────────────────────────────────────────────────── */}
      <SiemPanel alerts={siemAlerts} siemScanned={siemScanned} loading={siemLoading} />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search description…" className="pl-8 h-8 text-sm" />
              {search && (
                <button onClick={() => { setSearch(""); setFilters(f => ({ ...f, search: "" })); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

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

            <Select value={filters.module ?? ""} onValueChange={v => setFilter("module", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs w-[140px]">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <Input type="date" value={filters.fromDate ?? ""} onChange={e => setFilter("fromDate", e.target.value)} className="h-8 text-xs w-[130px]" title="From date" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="date" value={filters.toDate ?? ""} onChange={e => setFilter("toDate", e.target.value)} className="h-8 text-xs w-[130px]" title="To date" />
            </div>

            <Select value={String(limit)} onValueChange={v => { setLimit(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs w-[80px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
              </SelectContent>
            </Select>

            {activeFilters.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={resetAll}>
                <RotateCcw className="h-3 w-3" /> Reset
              </Button>
            )}
          </div>

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

      {/* ── Event Table ─────────────────────────────────────────────────────── */}
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
                ? rows.map((log: any) => {
                    const sev = alertSeverityById[log.id];
                    const alertCls = sev ? ROW_ALERT_CLASS[sev] : "";
                    return (
                      <TableRow key={log.id} className={`hover:bg-muted/40 align-top ${alertCls}`}>
                        <TableCell className="pl-4 py-2.5">
                          <p className="text-xs tabular-nums text-foreground">
                            {new Date(log.createdAt).toLocaleString("en-GB", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(log.createdAt)}</p>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <ActionBadge action={log.action} />
                            {sev && (
                              <span title={`${sev} severity anomaly`}>
                                <AlertTriangle className={`h-3 w-3 ${sev === "HIGH" ? "text-red-500" : sev === "MEDIUM" ? "text-amber-500" : "text-yellow-500"}`} />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell py-2.5"><ModuleBadge module={log.module} /></TableCell>
                        <TableCell className="hidden sm:table-cell py-2.5 text-xs text-muted-foreground">
                          {log.username ?? "System"}
                        </TableCell>
                        <TableCell className="pr-4 py-2.5 text-xs text-foreground/80 max-w-xs" title={log.description}>
                          {log.description}
                        </TableCell>
                      </TableRow>
                    );
                  })
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

          <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
            <span>
              {total === 0 ? "No results"
                : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} events`}
            </span>
            {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
