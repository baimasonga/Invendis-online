import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import {
  getFarmerBeneficiaryReport, getStockMovementReport, getDistributionReport,
  getConsolidatedDistributionReport, listAllCampaigns, getMEReport,
  listIncidents, type ConsolidatedDispatch, KEYS,
} from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, MapPin, TrendingUp, Download, Truck, Package, CalendarDays, X,
  AlertTriangle, CheckCircle2, Clock, Printer, ChevronDown, ChevronUp,
  FileText, Filter, RotateCcw, FileSpreadsheet, ShieldCheck, Target,
  Leaf, UserCheck, BarChart2, Sprout,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { writePrintDocument } from "@/lib/utils";

// ── Shared helpers ────────────────────────────────────────────────────────────

function downloadCSV(rows: any[], columns: { key: string; label: string }[], filename: string) {
  if (!rows.length) return;
  const header = columns.map(c => `"${c.label}"`).join(",");
  const lines  = rows.map(row =>
    columns.map(c => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function downloadXLSX(rows: any[], columns: { key: string; label: string }[], filename: string) {
  if (!rows.length) return;
  const header = columns.map(c => c.label);
  const data   = rows.map(row => columns.map(c => row[c.key] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename);
}

function KpiCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 justify-end">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-xs tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

const TXN_STYLES: Record<string, string> = {
  receive:      "bg-emerald-100 text-emerald-800",
  transfer_out: "bg-red-100    text-red-800",
  transfer_in:  "bg-blue-100   text-blue-800",
  dispatch:     "bg-indigo-100 text-indigo-800",
  adjustment:   "bg-amber-100  text-amber-800",
};

const DIST_STATUS_STYLES: Record<string, string> = {
  draft:       "bg-slate-100  text-slate-600",
  pending:     "bg-slate-100  text-slate-600",
  approved:    "bg-amber-100  text-amber-800",
  dispatched:  "bg-blue-100   text-blue-800",
  "in transit":"bg-blue-100   text-blue-800",
  arrived:     "bg-teal-100   text-teal-800",
  completed:   "bg-emerald-100 text-emerald-800",
  cancelled:   "bg-red-100    text-red-800",
};

function DateRangeFilter({
  from, to, onFrom, onTo, onClear,
}: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; onClear: () => void }) {
  const hasRange = from || to;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="h-8 text-xs w-[130px]" />
      <span className="text-xs text-muted-foreground">to</span>
      <Input type="date" value={to}   onChange={e => onTo(e.target.value)}   className="h-8 text-xs w-[130px]" />
      {hasRange && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function DistrictBar({ district, value, max }: { district: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-28 shrink-0 truncate">{district}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium tabular-nums w-8 text-right">{value}</span>
    </div>
  );
}

// ── Print HTML generator ──────────────────────────────────────────────────────

function generatePrintHtml(dispatches: ConsolidatedDispatch[], filterDesc: string): string {
  const now = new Date().toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const fmtDate = (s: string | null) =>
    s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtN = (n: number) => n.toLocaleString();

  const totalLoaded    = dispatches.reduce((s, d) => s + d.stats.totalLoaded, 0);
  const totalDelivered = dispatches.reduce((s, d) => s + d.stats.totalDelivered, 0);
  const totalPods      = dispatches.reduce((s, d) => s + d.stats.podCount, 0);
  const totalVerified  = dispatches.reduce((s, d) => s + d.stats.verifiedCount, 0);

  const sections = dispatches.map((d, idx) => {
    const itemRows = d.items.length
      ? d.items.map(it => {
          const variance = it.quantityDelivered - it.quantityLoaded;
          return `<tr>
            <td>${it.itemName}</td><td>${it.unit}</td>
            <td class="num">${fmtN(it.quantityLoaded)}</td>
            <td class="num">${fmtN(it.quantityDelivered)}</td>
            <td class="num">${fmtN(it.quantityReturned)}</td>
            <td class="num ${variance < 0 ? "neg" : "pos"}">${variance >= 0 ? "+" : ""}${fmtN(variance)}</td>
          </tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">No items recorded for this dispatch</td></tr>';

    const totRetd = d.items.reduce((s, i) => s + i.quantityReturned, 0);
    const totVar  = d.stats.totalDelivered - d.stats.totalLoaded;

    const podRows = d.pods.length
      ? d.pods.map(p => `<tr>
          <td class="mono">${p.podCode}</td>
          <td>${p.farmerName}</td>
          <td class="mono">${p.farmerCode}</td>
          <td>${p.gender}</td>
          <td>${p.phone || "—"}</td>
          <td class="num">${p.quantityDelivered ?? "—"}</td>
          <td class="sc ${p.otpStatus?.toLowerCase()}">${p.otpStatus}</td>
          <td class="sc ${p.faceStatus?.toLowerCase()}">${p.faceStatus}</td>
          <td class="sc ${p.status?.toLowerCase().replace(/\s/g, "-")}">${p.status}</td>
          <td class="small">${p.submittedAt ? new Date(p.submittedAt).toLocaleDateString("en-GB") : "—"}</td>
        </tr>`).join("")
      : '<tr><td colspan="10" class="empty">No Proof of Delivery records — distribution in progress or pending</td></tr>';

    return `
    <div class="dispatch">
      <div class="dh">
        <div class="dh-title">
          <span class="mc">${d.manifestCode}</span>
          <span class="sb sb-${d.status.toLowerCase().replace(/\s+/g,"-")}">${d.status}</span>
          <span class="dn">#${idx + 1} of ${dispatches.length}</span>
        </div>
        <div class="mg">
          <div><label>Campaign</label><span>${d.campaignName}</span></div>
          <div><label>Campaign Code</label><span>${d.campaignCode}</span></div>
          <div><label>Season</label><span>${d.season}</span></div>
          <div><label>Warehouse</label><span>${d.warehouseName}</span></div>
          <div><label>Vehicle</label><span>${d.vehiclePlate ? `${d.vehiclePlate} (${d.vehicleType})` : d.vehicleType}</span></div>
          <div><label>Driver</label><span>${d.driverName ?? "—"}</span></div>
          <div><label>Departed</label><span>${fmtDate(d.departedAt)}</span></div>
          <div><label>Arrived</label><span>${fmtDate(d.arrivedAt)}</span></div>
        </div>
        ${d.notes ? `<div class="note">Notes: ${d.notes}</div>` : ""}
      </div>

      <div class="sh">Items Loaded &amp; Delivered (${d.items.length} item type${d.items.length !== 1 ? "s" : ""})</div>
      <table class="dt">
        <thead><tr><th>Input Item</th><th>Unit</th><th>Loaded</th><th>Delivered</th><th>Returned</th><th>Variance</th></tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr>
          <td colspan="2"><b>Totals</b></td>
          <td class="num"><b>${fmtN(d.stats.totalLoaded)}</b></td>
          <td class="num"><b>${fmtN(d.stats.totalDelivered)}</b></td>
          <td class="num"><b>${fmtN(totRetd)}</b></td>
          <td class="num ${totVar < 0 ? "neg" : "pos"}"><b>${totVar >= 0 ? "+" : ""}${fmtN(totVar)}</b></td>
        </tr></tfoot>
      </table>

      <div class="sh">Proof of Delivery Records — ${d.stats.podCount} total · ${d.stats.verifiedCount} verified · ${d.stats.pendingCount} pending · ${d.stats.exceptionCount} exceptions</div>
      <table class="dt">
        <thead><tr><th>PoD Code</th><th>Farmer Name</th><th>Code</th><th>Gender</th><th>Phone</th><th>Qty</th><th>OTP</th><th>Face</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${podRows}</tbody>
      </table>

      <div class="sigs">
        <div class="sig"><div class="sl"></div><p>Supervisor Signature &amp; Name</p></div>
        <div class="sig"><div class="sl"></div><p>Field Officer Signature</p></div>
        <div class="sig"><div class="sl"></div><p>Date Verified</p></div>
        <div class="sig"><div class="sl"></div><p>Official Stamp</p></div>
      </div>
    </div>`;
  }).join('<div class="pb"></div>');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Distribution Consolidation Report — Invendis</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:10mm}
.rh{border-bottom:3px solid #166534;padding-bottom:10px;margin-bottom:14px}
.rh .org{font-size:10px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.5px}
.rh h1{font-size:18px;font-weight:700;color:#166534;margin:3px 0}
.rh .rmeta{font-size:9px;color:#666;display:flex;gap:18px;flex-wrap:wrap;margin-top:4px}
.sbar{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:8px 12px;margin-bottom:14px;display:flex;gap:20px;flex-wrap:wrap}
.sbar .st .v{font-size:18px;font-weight:700;color:#166534}
.sbar .st .l{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#555}
.dispatch{margin-bottom:18px;border:1px solid #d1d5db;border-radius:4px;overflow:hidden}
.dh{background:#f8fafc;border-bottom:1px solid #e5e7eb;padding:9px 12px}
.dh-title{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.mc{font-size:14px;font-weight:700;font-family:monospace}
.sb{font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;text-transform:uppercase}
.sb-completed{background:#dcfce7;color:#166534}
.sb-in-transit{background:#dbeafe;color:#1d4ed8}
.sb-approved{background:#fef3c7;color:#92400e}
.sb-draft{background:#f1f5f9;color:#475569}
.sb-arrived{background:#ccfbf1;color:#0f766e}
.sb-cancelled{background:#fee2e2;color:#991b1b}
.dn{font-size:9px;color:#9ca3af;margin-left:auto}
.mg{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.mg div{display:flex;flex-direction:column}
.mg label{font-size:9px;text-transform:uppercase;color:#9ca3af;letter-spacing:.3px}
.mg span{font-size:10px;font-weight:600}
.note{margin-top:5px;font-size:9px;color:#6b7280;font-style:italic}
.sh{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#6b7280;padding:5px 12px 4px;border-top:1px solid #f3f4f6;background:#fafafa;font-weight:600}
.dt{width:100%;border-collapse:collapse}
.dt th{background:#f1f5f9;font-size:9px;text-transform:uppercase;letter-spacing:.3px;padding:4px 7px;border-bottom:1px solid #e5e7eb;text-align:left;font-weight:600}
.dt td{padding:3px 7px;border-bottom:1px solid #f3f4f6;font-size:10px}
.dt tfoot td{background:#f8fafc;border-top:1px solid #e5e7eb}
.dt .num{text-align:right;font-family:monospace}
.dt .mono{font-family:monospace;font-size:9px}
.dt .small{font-size:9px}
.dt .empty{color:#9ca3af;font-style:italic;text-align:center;padding:7px}
.neg{color:#dc2626}.pos{color:#16a34a}
.sc{font-size:9px;font-weight:600}
.sc.verified{color:#16a34a}.sc.pending{color:#d97706}.sc.failed,.sc.exception{color:#dc2626}
.sigs{display:flex;gap:12px;padding:10px 12px;border-top:1px solid #e5e7eb}
.sig{flex:1}.sl{border-bottom:1px solid #374151;height:24px;margin-bottom:3px}
.sig p{font-size:9px;color:#6b7280;text-align:center}
.pb{page-break-after:always;height:0}
@media print{body{padding:0}.dispatch{break-inside:avoid}.pb{page-break-after:always}}
</style></head><body>
<div class="rh">
  <div class="org">Invendis · Agricultural Input Distribution System · Sierra Leone</div>
  <h1>Distribution Consolidation Report</h1>
  <div class="rmeta">
    <span>Generated: ${now}</span>
    <span>Filter: ${filterDesc}</span>
    <span>Dispatches included: ${dispatches.length}</span>
  </div>
</div>
<div class="sbar">
  <div class="st"><div class="v">${dispatches.length}</div><div class="l">Dispatches</div></div>
  <div class="st"><div class="v">${dispatches.filter(d => d.status === "Completed").length}</div><div class="l">Completed</div></div>
  <div class="st"><div class="v">${dispatches.filter(d => d.status === "In Transit").length}</div><div class="l">In Transit</div></div>
  <div class="st"><div class="v">${dispatches.filter(d => d.status === "Approved").length}</div><div class="l">Approved</div></div>
  <div class="st"><div class="v">${fmtN(totalLoaded)}</div><div class="l">Units Loaded</div></div>
  <div class="st"><div class="v">${fmtN(totalDelivered)}</div><div class="l">Units Delivered</div></div>
  <div class="st"><div class="v">${totalPods}</div><div class="l">PoD Records</div></div>
  <div class="st"><div class="v">${totalVerified}</div><div class="l">Verified PoDs</div></div>
</div>
${sections}
</body></html>`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

const DISPATCH_STATUSES = ["Draft", "Approved", "In Transit", "Arrived", "Completed", "Cancelled"];

export default function Reports() {
  // existing tab state
  const [stockFrom, setStockFrom] = useState("");
  const [stockTo,   setStockTo]   = useState("");
  const [distFrom,  setDistFrom]  = useState("");
  const [distTo,    setDistTo]    = useState("");
  const [incPage,      setIncPage]      = useState(1);
  const [incStatus,    setIncStatus]    = useState("");
  const [incExporting, setIncExporting] = useState(false);

  // consolidation tab state
  const [conStatus,     setConStatus]     = useState("");
  const [conCampaignId, setConCampaignId] = useState<number | null>(null);
  const [conFrom,       setConFrom]       = useState("");
  const [conTo,         setConTo]         = useState("");
  const [selectedIds,   setSelectedIds]   = useState<Set<number>>(new Set());
  const [expandedId,    setExpandedId]    = useState<number | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: meData, isLoading: loadingMe } = useQuery({ queryKey: KEYS.meReport(), queryFn: getMEReport });
  const { data: benReport,  isLoading: loadingBen }   = useQuery({ queryKey: KEYS.reports("beneficiary"), queryFn: getFarmerBeneficiaryReport });
  const { data: stockRows,  isLoading: loadingStock }  = useQuery({ queryKey: KEYS.reports("stock", stockFrom || undefined, stockTo || undefined), queryFn: () => getStockMovementReport(stockFrom || undefined, stockTo || undefined) });
  const { data: distRows,   isLoading: loadingDist }   = useQuery({ queryKey: KEYS.reports("distribution", distFrom || undefined, distTo || undefined), queryFn: () => getDistributionReport(distFrom || undefined, distTo || undefined) });
  const { data: incData,    isLoading: loadingInc }    = useQuery({ queryKey: KEYS.incidents(incPage, incStatus || undefined), queryFn: () => listIncidents(incPage, 30, incStatus || undefined) });

  // ── Consolidation queries ───────────────────────────────────────────────────

  const conOpts = { from: conFrom || undefined, to: conTo || undefined, campaignId: conCampaignId ?? undefined, status: conStatus || undefined };
  const { data: conList = [], isLoading: loadingCon } = useQuery({
    queryKey: KEYS.consolidation(conOpts),
    queryFn:  () => getConsolidatedDistributionReport(conOpts),
  });
  const { data: allCampaigns = [] } = useQuery({
    queryKey: KEYS.allCampaigns(),
    queryFn:  listAllCampaigns,
    staleTime: 5 * 60_000,
  });

  // ── Derived values ──────────────────────────────────────────────────────────

  const beneficiaryCols = [
    { key: "district", label: "District" }, { key: "total", label: "Total" },
    { key: "approved", label: "Approved" }, { key: "pending", label: "Pending" },
    { key: "female", label: "Female" }, { key: "femalePct", label: "Female %" },
    { key: "farmSize", label: "Farm Size (ha)" },
  ];
  const vcBenCols = [
    { key: "valueChain", label: "Value Chain" }, { key: "total", label: "Total" },
    { key: "approved", label: "Approved" }, { key: "female", label: "Female" }, { key: "femalePct", label: "Female %" },
  ];
  const stockCols = [
    { key: "createdAt", label: "Date" }, { key: "txnType", label: "Type" },
    { key: "itemName", label: "Input Item" }, { key: "warehouseName", label: "Warehouse" }, { key: "quantity", label: "Quantity" },
  ];
  const distributionCols = [
    { key: "manifestCode", label: "Manifest" }, { key: "campaignName", label: "Campaign" },
    { key: "warehouseName", label: "Warehouse" }, { key: "status", label: "Status" }, { key: "completionPct", label: "Completion %" },
  ];

  const incidentsCols = [
    { key: "incidentCode", label: "Code" }, { key: "incidentType", label: "Type" },
    { key: "officerName", label: "Officer" }, { key: "location", label: "Location" },
    { key: "status", label: "Status" }, { key: "createdAt", label: "Reported" },
    { key: "resolutionNotes", label: "Resolution Notes" },
  ];

  async function exportIncidents() {
    setIncExporting(true);
    try {
      const result = await listIncidents(1, 9999, incStatus || undefined);
      downloadCSV(result.data ?? [], incidentsCols, `incidents-${today}.csv`);
    } finally {
      setIncExporting(false);
    }
  }

  async function exportIncidentsXLSX() {
    setIncExporting(true);
    try {
      const result = await listIncidents(1, 9999, incStatus || undefined);
      downloadXLSX(result.data ?? [], incidentsCols, `incidents-${today}.xlsx`);
    } finally {
      setIncExporting(false);
    }
  }

  const benRows: any[]  = (benReport as any)?.rows ?? [];
  const vcRows: any[]   = (benReport as any)?.vcRows ?? [];
  const ageRows: any[]  = (benReport as any)?.ageRows ?? [];
  const summary: any    = (benReport as any)?.summary ?? {};
  const meVerif: any    = (meData as any)?.verification ?? {};
  const meCampaigns: any[] = (meData as any)?.campaigns ?? [];
  const meByVc: any[]   = (meData as any)?.byValueChain ?? [];
  const stockList       = Array.isArray(stockRows) ? stockRows : [];
  const distList        = Array.isArray(distRows)  ? distRows  : [];
  const incList         = incData?.data ?? [];
  const incTotal        = incData?.total ?? 0;
  const incTotalPages   = Math.max(1, Math.ceil(incTotal / 30));
  const maxDistrictVal  = Math.max(1, ...benRows.map((r: any) => r.total));

  const conCompleted   = conList.filter(d => d.status === "Completed").length;
  const conInTransit   = conList.filter(d => d.status === "In Transit").length;
  const conApproved    = conList.filter(d => d.status === "Approved").length;
  const conTotalPods   = conList.reduce((s, d) => s + d.stats.podCount, 0);
  const conTotalLoaded = conList.reduce((s, d) => s + d.stats.totalLoaded, 0);
  const selectedDispatches = useMemo(
    () => conList.filter(d => selectedIds.has(d.id)),
    [conList, selectedIds]
  );
  const hasConFilter = !!(conStatus || conCampaignId || conFrom || conTo);

  // ── Print ───────────────────────────────────────────────────────────────────

  function printDispatches(dispatches: ConsolidatedDispatch[]) {
    if (!dispatches.length) return;
    const parts: string[] = [];
    if (conStatus)                  parts.push(`Status: ${conStatus}`);
    if (conCampaignId) {
      const c = allCampaigns.find((c: any) => c.id === conCampaignId);
      if (c) parts.push(`Campaign: ${c.name}`);
    }
    if (conFrom || conTo) parts.push(`Period: ${conFrom || "start"} → ${conTo || "today"}`);
    const filterDesc = parts.length ? parts.join(" | ") : "All dispatches";

    const html = generatePrintHtml(dispatches, filterDesc);
    const win  = window.open("", "_blank");
    if (!win) { alert("Please allow popups to print the report."); return; }
    writePrintDocument(win, html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  function exportConsolidationCsv(dispatches: ConsolidatedDispatch[]) {
    const rows: any[] = [];
    for (const d of dispatches) {
      if (d.pods.length === 0) {
        rows.push({
          manifest: d.manifestCode, status: d.status, campaign: d.campaignName,
          warehouse: d.warehouseName, vehicle: d.vehiclePlate ?? "—", driver: d.driverName ?? "—",
          season: d.season, departed: d.departedAt ?? "", arrived: d.arrivedAt ?? "",
          podCode: "", farmerName: "", farmerCode: "", gender: "", phone: "",
          qtyDelivered: "", podStatus: "", otpStatus: "", faceStatus: "",
          itemsSummary: d.items.map(i => `${i.itemName}:${i.quantityLoaded}${i.unit}`).join("; "),
          totalLoaded: d.stats.totalLoaded, totalDelivered: d.stats.totalDelivered,
        });
      } else {
        for (const p of d.pods) {
          rows.push({
            manifest: d.manifestCode, status: d.status, campaign: d.campaignName,
            warehouse: d.warehouseName, vehicle: d.vehiclePlate ?? "—", driver: d.driverName ?? "—",
            season: d.season, departed: d.departedAt ?? "", arrived: d.arrivedAt ?? "",
            podCode: p.podCode, farmerName: p.farmerName, farmerCode: p.farmerCode,
            gender: p.gender, phone: p.phone, qtyDelivered: p.quantityDelivered ?? "",
            podStatus: p.status, otpStatus: p.otpStatus, faceStatus: p.faceStatus,
            itemsSummary: d.items.map(i => `${i.itemName}:${i.quantityLoaded}${i.unit}`).join("; "),
            totalLoaded: d.stats.totalLoaded, totalDelivered: d.stats.totalDelivered,
          });
        }
      }
    }
    const cols = [
      { key: "manifest", label: "Manifest" }, { key: "status", label: "Status" },
      { key: "campaign", label: "Campaign" }, { key: "season", label: "Season" },
      { key: "warehouse", label: "Warehouse" }, { key: "vehicle", label: "Vehicle" },
      { key: "driver", label: "Driver" }, { key: "departed", label: "Departed" },
      { key: "arrived", label: "Arrived" }, { key: "podCode", label: "PoD Code" },
      { key: "farmerName", label: "Farmer Name" }, { key: "farmerCode", label: "Farmer Code" },
      { key: "gender", label: "Gender" }, { key: "phone", label: "Phone" },
      { key: "qtyDelivered", label: "Qty Delivered" }, { key: "podStatus", label: "PoD Status" },
      { key: "otpStatus", label: "OTP" }, { key: "faceStatus", label: "Face" },
      { key: "itemsSummary", label: "Items Loaded" },
      { key: "totalLoaded", label: "Total Loaded" }, { key: "totalDelivered", label: "Total Delivered" },
    ];
    downloadCSV(rows, cols, `distribution-consolidation-${today}.csv`);
  }

  function toggleSelectAll() {
    if (selectedIds.size === conList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(conList.map(d => d.id)));
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetConFilters() {
    setConStatus(""); setConCampaignId(null); setConFrom(""); setConTo("");
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Reports & Analytics" subtitle="Comprehensive operational data across all modules." />

      <Tabs defaultValue="me">
        <TabsList className="h-8 flex-wrap">
          <TabsTrigger value="me"             className="text-xs">M&amp;E Summary</TabsTrigger>
          <TabsTrigger value="beneficiary"    className="text-xs">Beneficiaries</TabsTrigger>
          <TabsTrigger value="stock"          className="text-xs">Stock Movement</TabsTrigger>
          <TabsTrigger value="distribution"   className="text-xs">Distribution</TabsTrigger>
          <TabsTrigger value="consolidation"  className="text-xs">Consolidation</TabsTrigger>
          <TabsTrigger value="incidents"      className="text-xs">Incidents</TabsTrigger>
        </TabsList>

        {/* ── M&E Summary tab ────────────────────────────────────────────────── */}
        <TabsContent value="me" className="mt-4 space-y-4">

          {/* Verification KPIs */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Proof of Delivery Verification Rates</p>
            {loadingMe ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <KpiCard label="Total PoDs"       value={meVerif.podCount ?? 0}             icon={FileText}     color="bg-slate-100 text-slate-700" />
                <KpiCard label="OTP Verified"     value={`${meVerif.otpRate ?? 0}%`}        icon={ShieldCheck}  color="bg-blue-100 text-blue-700" />
                <KpiCard label="Face Verified"    value={`${meVerif.faceRate ?? 0}%`}       icon={UserCheck}    color="bg-violet-100 text-violet-700" />
                <KpiCard label="GPS Captured"     value={`${meVerif.gpsRate ?? 0}%`}        icon={MapPin}       color="bg-teal-100 text-teal-700" />
                <KpiCard label="Female Recipients" value={`${meVerif.femaleRate ?? 0}%`}   icon={Users}        color="bg-pink-100 text-pink-700" />
              </div>
            )}
          </div>

          {/* Campaign reach */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Target className="h-4 w-4 text-green-700" />
                Campaign Reach &amp; Delivery Performance
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!meCampaigns.length}
                onClick={() => downloadXLSX(meCampaigns.map((c: any) => ({
                  name: c.name, code: c.campaignCode, season: c.season, status: c.status,
                  targetFarmers: c.targetFarmers, allocatedFarmers: c.allocatedFarmers, allocationRate: `${c.allocationRate}%`,
                  deliveredCount: c.deliveredCount, deliveryRate: `${c.deliveryRate}%`,
                  femaleDelivered: c.femaleDelivered, femalePct: `${c.femalePct}%`,
                })), [
                  { key: "name", label: "Campaign" }, { key: "code", label: "Code" }, { key: "season", label: "Season" },
                  { key: "status", label: "Status" }, { key: "targetFarmers", label: "Target" },
                  { key: "allocatedFarmers", label: "Allocated" }, { key: "allocationRate", label: "Allocation Rate" },
                  { key: "deliveredCount", label: "Delivered" }, { key: "deliveryRate", label: "Delivery Rate" },
                  { key: "femaleDelivered", label: "Female" }, { key: "femalePct", label: "Female %" },
                ], `me-campaigns-${today}.xlsx`)}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Export
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Campaign</TableHead>
                    <TableHead className="hidden md:table-cell">Season</TableHead>
                    <TableHead className="hidden md:table-cell">Status</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Allocated</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Alloc. Rate</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Delivery Rate</TableHead>
                    <TableHead className="text-right pr-4 hidden xl:table-cell">Female %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMe
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                          <TableCell className="hidden xl:table-cell pr-4"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : meCampaigns.length > 0
                    ? meCampaigns.map((c: any) => (
                        <TableRow key={c.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4">
                            <div>
                              <p className="text-sm font-medium">{c.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{c.campaignCode}</p>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.season}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DIST_STATUS_STYLES[c.status?.toLowerCase()] ?? "bg-slate-100 text-slate-600"}`}>{c.status}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{c.targetFarmers.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{c.allocatedFarmers.toLocaleString()}</TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <CompletionBar pct={c.allocationRate} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-semibold text-emerald-700">{c.deliveredCount.toLocaleString()}</TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <CompletionBar pct={c.deliveryRate} />
                          </TableCell>
                          <TableCell className="text-right pr-4 hidden xl:table-cell text-sm text-pink-700 font-medium tabular-nums">{c.femalePct}%</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center text-sm text-muted-foreground">No campaign data</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Value chain delivery breakdown */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Leaf className="h-4 w-4 text-green-700" />
                Delivery by Value Chain
              </CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!meByVc.length}
                onClick={() => downloadCSV(meByVc, [
                  { key: "valueChain", label: "Value Chain" }, { key: "deliveries", label: "Deliveries" },
                  { key: "female", label: "Female" }, { key: "femalePct", label: "Female %" },
                  { key: "verified", label: "Verified" }, { key: "verifiedPct", label: "Verified %" },
                  { key: "qty", label: "Qty Delivered" },
                ], `me-value-chains-${today}.csv`)}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Value Chain</TableHead>
                    <TableHead className="text-right">Deliveries</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Female</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Female %</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Verified</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Verified %</TableHead>
                    <TableHead className="text-right pr-4 hidden xl:table-cell">Qty Delivered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMe
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                          <TableCell className="hidden xl:table-cell pr-4"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : meByVc.length > 0
                    ? meByVc.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              <Sprout className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              <span className="text-sm font-medium">{row.valueChain}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">{row.deliveries.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm text-pink-700 hidden md:table-cell tabular-nums">{row.female.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-sm font-medium hidden md:table-cell tabular-nums">{row.femalePct}%</TableCell>
                          <TableCell className="text-right text-sm text-emerald-700 hidden lg:table-cell tabular-nums">{row.verified.toLocaleString()}</TableCell>
                          <TableCell className="text-right hidden lg:table-cell">
                            <CompletionBar pct={row.verifiedPct} />
                          </TableCell>
                          <TableCell className="text-right pr-4 text-sm text-muted-foreground hidden xl:table-cell tabular-nums">{row.qty.toLocaleString()}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">No delivery data yet</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Beneficiary tab ────────────────────────────────────────────────── */}
        <TabsContent value="beneficiary" className="mt-4 space-y-4">
          {loadingBen ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
            </div>
          ) : benReport ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard label="Total Farmers"     value={summary.total ?? 0}              icon={Users}       color="bg-green-100 text-green-700" />
              <KpiCard label="Approved"           value={summary.approved ?? 0}           icon={CheckCircle2} color="bg-emerald-100 text-emerald-700" />
              <KpiCard label="Approval Rate"      value={`${summary.pctApproved ?? 0}%`} icon={TrendingUp}   color="bg-blue-100 text-blue-700" />
              <KpiCard label="Female Farmers"     value={summary.female ?? 0}             icon={Users}       color="bg-pink-100 text-pink-700" />
              <KpiCard label="Individual"         value={summary.individual ?? 0}         icon={UserCheck}   color="bg-indigo-100 text-indigo-700" />
              <KpiCard label="Group Beneficiaries" value={summary.group ?? 0}            icon={Users}       color="bg-amber-100 text-amber-700" />
            </div>
          ) : null}

          {benRows.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">District Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="pb-4 space-y-2.5">
                {benRows.map((row: any, i: number) => (
                  <DistrictBar key={i} district={row.district} value={row.total} max={maxDistrictVal} />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Farmers by District</CardTitle>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!benRows.length}
                  onClick={() => downloadCSV(benRows, beneficiaryCols, `beneficiaries-${today}.csv`)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!benRows.length}
                  onClick={() => downloadXLSX(benRows, beneficiaryCols, `beneficiaries-${today}.xlsx`)}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">District</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Approved</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Pending</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Female</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Female %</TableHead>
                    <TableHead className="text-right pr-4 hidden xl:table-cell">Farm Size (ha)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingBen
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden xl:table-cell pr-4"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : benRows.length > 0
                    ? benRows.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium">{row.district}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums">{row.total}</TableCell>
                          <TableCell className="text-right text-sm text-emerald-700 hidden md:table-cell tabular-nums">{row.approved}</TableCell>
                          <TableCell className="text-right text-sm text-amber-700 hidden md:table-cell tabular-nums">{row.pending}</TableCell>
                          <TableCell className="text-right text-sm text-pink-700 hidden lg:table-cell tabular-nums">{row.female}</TableCell>
                          <TableCell className="text-right text-sm font-medium hidden lg:table-cell tabular-nums">{row.femalePct}%</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground pr-4 hidden xl:table-cell tabular-nums">{row.farmSize > 0 ? `${row.farmSize} ha` : "—"}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">No beneficiary data</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Value chain breakdown */}
          {vcRows.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Leaf className="h-4 w-4 text-green-700" />
                  Farmers by Value Chain
                </CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!vcRows.length}
                  onClick={() => downloadCSV(vcRows, vcBenCols, `beneficiaries-by-valuechain-${today}.csv`)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Value Chain</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Approved</TableHead>
                      <TableHead className="text-right hidden md:table-cell">Female</TableHead>
                      <TableHead className="text-right pr-4">Female %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vcRows.map((row: any, i: number) => (
                      <TableRow key={i} className="hover:bg-muted/40">
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-2">
                            <Sprout className="h-3.5 w-3.5 text-green-600 shrink-0" />
                            <span className="text-sm font-medium">{row.valueChain}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right text-sm text-emerald-700 hidden md:table-cell tabular-nums">{row.approved}</TableCell>
                        <TableCell className="text-right text-sm text-pink-700 hidden md:table-cell tabular-nums">{row.female}</TableCell>
                        <TableCell className="text-right text-sm font-medium pr-4 tabular-nums">{row.femalePct}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Age group breakdown */}
          {ageRows.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-indigo-600" />
                  Beneficiaries by Age Group
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4 space-y-2.5">
                {(() => {
                  const maxAge = Math.max(1, ...ageRows.map((r: any) => r.count));
                  return ageRows.map((row: any, i: number) => (
                    <DistrictBar key={i} district={row.ageGroup} value={row.count} max={maxAge} />
                  ));
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Stock movement tab ─────────────────────────────────────────────── */}
        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 space-y-2">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Stock Movement Ledger</CardTitle>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!stockList.length}
                    onClick={() => downloadCSV(stockList, stockCols, `stock-movement-${today}.csv`)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!stockList.length}
                    onClick={() => downloadXLSX(stockList, stockCols, `stock-movement-${today}.xlsx`)}>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
                  </Button>
                </div>
              </div>
              <DateRangeFilter from={stockFrom} to={stockTo} onFrom={setStockFrom} onTo={setStockTo} onClear={() => { setStockFrom(""); setStockTo(""); }} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 hidden md:table-cell">Date</TableHead>
                    <TableHead className="pl-4 md:pl-0">Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden lg:table-cell">Warehouse</TableHead>
                    <TableHead className="text-right pr-4">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingStock
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4 hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="pl-4 md:pl-0"><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : stockList.length > 0
                    ? stockList.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4 hidden md:table-cell text-xs text-muted-foreground">
                            {row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          </TableCell>
                          <TableCell className="pl-4 md:pl-0">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TXN_STYLES[row.txnType?.toLowerCase().replace(/\s+/g, "_")] ?? "bg-slate-100 text-slate-600"}`}>
                              {row.txnType}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{row.itemName ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{row.warehouseName ?? "—"}</TableCell>
                          <TableCell className="pr-4 text-right font-semibold tabular-nums text-sm">{row.quantity}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                            {(stockFrom || stockTo) ? "No stock movements in this date range" : "No stock movement data"}
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Distribution summary tab ────────────────────────────────────────── */}
        <TabsContent value="distribution" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 space-y-2">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Distribution Manifests</CardTitle>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!distList.length}
                    onClick={() => downloadCSV(distList, distributionCols, `distribution-${today}.csv`)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!distList.length}
                    onClick={() => downloadXLSX(distList, distributionCols, `distribution-${today}.xlsx`)}>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
                  </Button>
                </div>
              </div>
              <DateRangeFilter from={distFrom} to={distTo} onFrom={setDistFrom} onTo={setDistTo} onClear={() => { setDistFrom(""); setDistTo(""); }} />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[130px]">Manifest</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                    <TableHead className="hidden md:table-cell">Status</TableHead>
                    <TableHead className="text-right pr-4">Completion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDist
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : distList.length > 0
                    ? distList.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-1.5">
                              <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-mono text-xs">{row.manifestCode}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-medium">{row.campaignName ?? "—"}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{row.warehouseName ?? "—"}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DIST_STATUS_STYLES[row.status?.toLowerCase()] ?? "bg-slate-100 text-slate-600"}`}>
                              {row.status}
                            </span>
                          </TableCell>
                          <TableCell className="pr-4"><CompletionBar pct={row.completionPct ?? 0} /></TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Package className="h-8 w-8 opacity-30" />
                              <span className="text-sm">{(distFrom || distTo) ? "No dispatches in this date range" : "No distribution data yet"}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Consolidation tab ───────────────────────────────────────────────── */}
        <TabsContent value="consolidation" className="mt-4 space-y-4">

          {/* Filter bar */}
          <Card>
            <CardContent className="px-4 py-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                  <Filter className="h-3.5 w-3.5" /> Filters:
                </div>

                <Select value={conStatus} onValueChange={v => { setConStatus(v === "all" ? "" : v); setSelectedIds(new Set()); }}>
                  <SelectTrigger className="h-8 text-xs w-[140px]">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {DISPATCH_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>

                <Select
                  value={conCampaignId ? String(conCampaignId) : "all"}
                  onValueChange={v => { setConCampaignId(v === "all" ? null : Number(v)); setSelectedIds(new Set()); }}
                >
                  <SelectTrigger className="h-8 text-xs w-[200px]">
                    <SelectValue placeholder="All campaigns" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All campaigns</SelectItem>
                    {allCampaigns.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <DateRangeFilter
                  from={conFrom} to={conTo}
                  onFrom={v => { setConFrom(v); setSelectedIds(new Set()); }}
                  onTo={v => { setConTo(v); setSelectedIds(new Set()); }}
                  onClear={() => { setConFrom(""); setConTo(""); setSelectedIds(new Set()); }}
                />

                {hasConFilter && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={resetConFilters}>
                    <RotateCcw className="h-3 w-3" /> Reset
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* KPI cards */}
          {!loadingCon && conList.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label="Total Dispatches"  value={conList.length}    icon={Truck}        color="bg-indigo-100 text-indigo-700" />
              <KpiCard label="Completed"         value={conCompleted}      icon={CheckCircle2} color="bg-emerald-100 text-emerald-700" />
              <KpiCard label="In Transit"        value={conInTransit}      icon={Truck}        color="bg-blue-100 text-blue-700" />
              <KpiCard label="Units Loaded"      value={conTotalLoaded.toLocaleString()} icon={Package} color="bg-amber-100 text-amber-700" />
              <KpiCard label="PoD Records"       value={conTotalPods}      icon={FileText}     color="bg-teal-100 text-teal-700" />
            </div>
          )}

          {/* Action bar + table */}
          <Card>
            <div className="px-4 py-2.5 border-b flex items-center gap-2 flex-wrap">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selectedIds.size === conList.length && conList.length > 0 ? "bg-green-700 border-green-700" : "border-muted-foreground"}`}>
                  {selectedIds.size === conList.length && conList.length > 0 && <span className="text-white text-[10px] font-bold">✓</span>}
                </div>
                {selectedIds.size === conList.length && conList.length > 0 ? "Deselect all" : "Select all"}
              </button>

              {selectedIds.size > 0 && (
                <span className="text-xs text-green-700 font-semibold">
                  {selectedIds.size} selected
                </span>
              )}

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <Button
                  size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                  disabled={selectedIds.size === 0}
                  onClick={() => printDispatches(selectedDispatches)}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Selected {selectedIds.size > 0 && `(${selectedIds.size})`}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                  disabled={conList.length === 0}
                  onClick={() => printDispatches(conList)}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print All {conList.length > 0 && `(${conList.length})`}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                  disabled={selectedIds.size === 0}
                  onClick={() => exportConsolidationCsv(selectedDispatches)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </div>
            </div>

            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-8"></TableHead>
                    <TableHead className="w-[140px]">Manifest</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                    <TableHead className="hidden lg:table-cell">Driver / Vehicle</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="hidden sm:table-cell text-center w-16">Items</TableHead>
                    <TableHead className="hidden sm:table-cell text-center w-16">PoDs</TableHead>
                    <TableHead className="text-right pr-2 w-28">Completion</TableHead>
                    <TableHead className="w-8 pr-4"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCon
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-4" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                          <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))
                    : conList.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={10} className="h-32 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Truck className="h-8 w-8 opacity-30" />
                              <span className="text-sm">{hasConFilter ? "No dispatches match this filter" : "No dispatches found"}</span>
                              {hasConFilter && (
                                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={resetConFilters}>
                                  <RotateCcw className="h-3 w-3" /> Clear filters
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    : conList.map(d => {
                        const isSelected = selectedIds.has(d.id);
                        const isExpanded = expandedId === d.id;
                        const statusKey  = d.status?.toLowerCase().replace(/\s+/g, " ");
                        return (
                          <>
                            <TableRow
                              key={d.id}
                              className={`hover:bg-muted/40 cursor-pointer align-middle ${isSelected ? "bg-green-50/60" : ""}`}
                              onClick={() => toggleSelect(d.id)}
                            >
                              <TableCell className="pl-4">
                                <div
                                  className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? "bg-green-700 border-green-700" : "border-muted-foreground"}`}
                                  onClick={e => { e.stopPropagation(); toggleSelect(d.id); }}
                                >
                                  {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1.5">
                                  <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  <span className="font-mono text-xs font-semibold">{d.manifestCode}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <p className="text-sm font-medium truncate max-w-[200px]">{d.campaignName}</p>
                                <p className="text-[10px] text-muted-foreground">{d.season}</p>
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{d.warehouseName}</TableCell>
                              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                                {d.driverName && <p>{d.driverName}</p>}
                                {d.vehiclePlate && <p className="font-mono">{d.vehiclePlate}</p>}
                                {!d.driverName && !d.vehiclePlate && <span>—</span>}
                              </TableCell>
                              <TableCell>
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${DIST_STATUS_STYLES[statusKey] ?? "bg-slate-100 text-slate-600"}`}>
                                  {d.status}
                                </span>
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-center text-xs tabular-nums">
                                {d.items.length}
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-center">
                                <span className={`text-xs tabular-nums font-medium ${d.stats.podCount > 0 ? (d.stats.verifiedCount === d.stats.podCount ? "text-emerald-600" : "text-amber-600") : "text-muted-foreground"}`}>
                                  {d.stats.podCount === 0 ? "—" : `${d.stats.verifiedCount}/${d.stats.podCount}`}
                                </span>
                              </TableCell>
                              <TableCell className="pr-2">
                                <CompletionBar pct={d.completionPct} />
                              </TableCell>
                              <TableCell className="pr-4">
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : d.id); }}
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </Button>
                              </TableCell>
                            </TableRow>

                            {/* ── Expanded detail panel ── */}
                            {isExpanded && (
                              <TableRow key={`${d.id}-exp`} className="hover:bg-transparent">
                                <TableCell colSpan={10} className="p-0 border-b-2 border-green-200">
                                  <div className="bg-slate-50 px-6 py-4 space-y-4">

                                    {/* Metadata row */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                      <div><p className="text-muted-foreground uppercase text-[10px] tracking-wide">Campaign Code</p><p className="font-semibold">{d.campaignCode}</p></div>
                                      <div><p className="text-muted-foreground uppercase text-[10px] tracking-wide">Season</p><p className="font-semibold">{d.season}</p></div>
                                      <div><p className="text-muted-foreground uppercase text-[10px] tracking-wide">Departed</p><p className="font-semibold">{d.departedAt ? new Date(d.departedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</p></div>
                                      <div><p className="text-muted-foreground uppercase text-[10px] tracking-wide">Arrived</p><p className="font-semibold">{d.arrivedAt ? new Date(d.arrivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</p></div>
                                    </div>
                                    {d.notes && <p className="text-xs text-muted-foreground italic">Notes: {d.notes}</p>}

                                    {/* Items table */}
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Items Loaded</p>
                                      <div className="rounded border overflow-hidden">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="hover:bg-transparent bg-slate-100">
                                              <TableHead className="pl-3 h-7 text-[10px]">Input Item</TableHead>
                                              <TableHead className="h-7 text-[10px]">Unit</TableHead>
                                              <TableHead className="text-right h-7 text-[10px]">Loaded</TableHead>
                                              <TableHead className="text-right h-7 text-[10px]">Delivered</TableHead>
                                              <TableHead className="text-right h-7 text-[10px]">Returned</TableHead>
                                              <TableHead className="text-right pr-3 h-7 text-[10px]">Variance</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {d.items.length === 0
                                              ? <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-3">No items</TableCell></TableRow>
                                              : d.items.map(it => {
                                                  const v = it.quantityDelivered - it.quantityLoaded;
                                                  return (
                                                    <TableRow key={it.id} className="hover:bg-slate-100/50">
                                                      <TableCell className="pl-3 py-1.5 text-xs font-medium">{it.itemName}</TableCell>
                                                      <TableCell className="py-1.5 text-xs text-muted-foreground">{it.unit}</TableCell>
                                                      <TableCell className="text-right py-1.5 text-xs tabular-nums">{it.quantityLoaded.toLocaleString()}</TableCell>
                                                      <TableCell className="text-right py-1.5 text-xs tabular-nums">{it.quantityDelivered.toLocaleString()}</TableCell>
                                                      <TableCell className="text-right py-1.5 text-xs tabular-nums">{it.quantityReturned.toLocaleString()}</TableCell>
                                                      <TableCell className={`text-right pr-3 py-1.5 text-xs tabular-nums font-semibold ${v < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                                        {v >= 0 ? "+" : ""}{v.toLocaleString()}
                                                      </TableCell>
                                                    </TableRow>
                                                  );
                                                })}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>

                                    {/* PoD table */}
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                                        Proof of Delivery — {d.stats.podCount} record{d.stats.podCount !== 1 ? "s" : ""}
                                        {d.stats.podCount > 0 && ` · ${d.stats.verifiedCount} verified · ${d.stats.pendingCount} pending`}
                                      </p>
                                      <div className="rounded border overflow-hidden">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="hover:bg-transparent bg-slate-100">
                                              <TableHead className="pl-3 h-7 text-[10px]">PoD Code</TableHead>
                                              <TableHead className="h-7 text-[10px]">Farmer</TableHead>
                                              <TableHead className="h-7 text-[10px] hidden sm:table-cell">Code</TableHead>
                                              <TableHead className="text-right h-7 text-[10px]">Qty</TableHead>
                                              <TableHead className="h-7 text-[10px] hidden md:table-cell">OTP</TableHead>
                                              <TableHead className="h-7 text-[10px] hidden md:table-cell">Face</TableHead>
                                              <TableHead className="h-7 text-[10px]">Status</TableHead>
                                              <TableHead className="pr-3 h-7 text-[10px] hidden lg:table-cell">Submitted</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {d.pods.length === 0
                                              ? (
                                                  <TableRow>
                                                    <TableCell colSpan={8} className="text-center py-4">
                                                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                                        <Clock className="h-5 w-5 opacity-40" />
                                                        <p className="text-xs">No PoD records yet — distribution in progress or pending</p>
                                                      </div>
                                                    </TableCell>
                                                  </TableRow>
                                                )
                                              : d.pods.map(p => (
                                                  <TableRow key={p.id} className="hover:bg-slate-100/50">
                                                    <TableCell className="pl-3 py-1.5 font-mono text-[10px]">{p.podCode}</TableCell>
                                                    <TableCell className="py-1.5 text-xs">{p.farmerName}</TableCell>
                                                    <TableCell className="py-1.5 font-mono text-[10px] hidden sm:table-cell text-muted-foreground">{p.farmerCode}</TableCell>
                                                    <TableCell className="text-right py-1.5 text-xs tabular-nums">{p.quantityDelivered ?? "—"}</TableCell>
                                                    <TableCell className="py-1.5 hidden md:table-cell">
                                                      <span className={`text-[10px] font-semibold ${p.otpStatus === "Verified" ? "text-emerald-600" : p.otpStatus === "Failed" ? "text-red-600" : "text-amber-600"}`}>{p.otpStatus}</span>
                                                    </TableCell>
                                                    <TableCell className="py-1.5 hidden md:table-cell">
                                                      <span className={`text-[10px] font-semibold ${p.faceStatus === "Verified" ? "text-emerald-600" : p.faceStatus === "Failed" ? "text-red-600" : "text-amber-600"}`}>{p.faceStatus}</span>
                                                    </TableCell>
                                                    <TableCell className="py-1.5">
                                                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${p.status === "Verified" ? "bg-emerald-100 text-emerald-700" : p.status === "Exception" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                                                        {p.status}
                                                      </span>
                                                    </TableCell>
                                                    <TableCell className="pr-3 py-1.5 text-[10px] text-muted-foreground hidden lg:table-cell">
                                                      {p.submittedAt ? new Date(p.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                                                    </TableCell>
                                                  </TableRow>
                                                ))}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>

                                    {/* Print single dispatch button */}
                                    <div className="flex justify-end">
                                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                                        onClick={() => printDispatches([d])}>
                                        <Printer className="h-3 w-3" /> Print this dispatch
                                      </Button>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Incidents tab ───────────────────────────────────────────────────── */}
        <TabsContent value="incidents" className="mt-4">
          <Card>
            <div className="px-4 pt-3 pb-2 border-b flex items-center gap-1.5 flex-wrap">
              {[{ label: "All", value: "" }, { label: "Open", value: "Open" }, { label: "Resolved", value: "Resolved" }].map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => { setIncStatus(value); setIncPage(1); }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${incStatus === value ? "bg-green-700 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                >
                  {label}
                </button>
              ))}
                      <div className="ml-auto flex items-center gap-2">
                {!loadingInc && (
                  <span className="text-xs text-muted-foreground">{incTotal} incidents</span>
                )}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={incExporting || incTotal === 0}
                  onClick={exportIncidents}>
                  <Download className="h-3.5 w-3.5 mr-1" /> {incExporting ? "…" : "CSV"}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={incExporting || incTotal === 0}
                  onClick={exportIncidentsXLSX}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1" /> {incExporting ? "…" : "Excel"}
                </Button>
              </div>
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
                  {loadingInc
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                          <TableCell className="hidden sm:table-cell pr-4"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : incList.length > 0
                    ? incList.map((inc: any) => (
                        <TableRow key={inc.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs">{inc.incidentCode}</TableCell>
                          <TableCell className="text-sm font-medium">{inc.incidentType ?? inc.type ?? "—"}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{inc.officerName ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{inc.location ?? "—"}</TableCell>
                          <TableCell>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${inc.status === "Resolved" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                              {inc.status}
                            </span>
                          </TableCell>
                          <TableCell className="pr-4 text-right text-xs text-muted-foreground hidden sm:table-cell">
                            {inc.createdAt ? new Date(inc.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <AlertTriangle className="h-8 w-8 opacity-30" />
                              <span className="text-sm">No incidents found</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
              {incTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-xs text-muted-foreground">
                  <span>{incTotal} incidents</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={incPage <= 1} onClick={() => setIncPage(p => p - 1)}>Prev</Button>
                    <span className="px-2">Page {incPage} of {incTotalPages}</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={incPage >= incTotalPages} onClick={() => setIncPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
