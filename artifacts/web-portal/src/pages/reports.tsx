import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFarmerBeneficiaryReport, getStockMovementReport, getDistributionReport, listIncidents, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, MapPin, TrendingUp, Download, Truck, Package, CalendarDays, X, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

function downloadCSV(rows: any[], columns: { key: string; label: string }[], filename: string) {
  if (!rows.length) return;
  const header = columns.map(c => `"${c.label}"`).join(",");
  const lines = rows.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "";
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: React.ElementType; color: string }) {
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
  receive:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  transfer_out: "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
  transfer_in:  "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  dispatch:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30  dark:text-indigo-400",
  adjustment:   "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
};

const DIST_STATUS_STYLES: Record<string, string> = {
  pending:    "bg-slate-100  text-slate-600",
  approved:   "bg-amber-100  text-amber-800",
  dispatched: "bg-blue-100   text-blue-800",
  arrived:    "bg-teal-100   text-teal-800",
  completed:  "bg-emerald-100 text-emerald-800",
  cancelled:  "bg-red-100    text-red-800",
};

function DateRangeFilter({
  from, to, onFrom, onTo, onClear,
}: {
  from: string; to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onClear: () => void;
}) {
  const hasRange = from || to;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Input
        type="date"
        value={from}
        onChange={(e) => onFrom(e.target.value)}
        className="h-8 text-xs w-[130px]"
        placeholder="From"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="date"
        value={to}
        onChange={(e) => onTo(e.target.value)}
        className="h-8 text-xs w-[130px]"
        placeholder="To"
      />
      {hasRange && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={onClear}>
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

const today = new Date().toISOString().slice(0, 10);

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

export default function Reports() {
  const [stockFrom, setStockFrom] = useState("");
  const [stockTo,   setStockTo]   = useState("");
  const [distFrom,  setDistFrom]  = useState("");
  const [distTo,    setDistTo]    = useState("");
  const [incPage,   setIncPage]   = useState(1);
  const [incStatus, setIncStatus] = useState("");

  const { data: benReport, isLoading: loadingBen } = useQuery({
    queryKey: KEYS.reports("beneficiary"),
    queryFn: getFarmerBeneficiaryReport,
  });
  const { data: stockRows, isLoading: loadingStock } = useQuery({
    queryKey: KEYS.reports("stock", stockFrom || undefined, stockTo || undefined),
    queryFn: () => getStockMovementReport(stockFrom || undefined, stockTo || undefined),
  });
  const { data: distRows, isLoading: loadingDist } = useQuery({
    queryKey: KEYS.reports("distribution", distFrom || undefined, distTo || undefined),
    queryFn: () => getDistributionReport(distFrom || undefined, distTo || undefined),
  });
  const { data: incData, isLoading: loadingInc } = useQuery({
    queryKey: KEYS.incidents(incPage, incStatus || undefined),
    queryFn: () => listIncidents(incPage, 30, incStatus || undefined),
  });

  const beneficiaryCols = [
    { key: "district", label: "District" },
    { key: "total",    label: "Total" },
    { key: "approved", label: "Approved" },
    { key: "pending",  label: "Pending" },
    { key: "female",   label: "Female" },
  ];
  const stockCols = [
    { key: "createdAt",    label: "Date" },
    { key: "txnType",      label: "Type" },
    { key: "itemName",     label: "Input Item" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "quantity",     label: "Quantity" },
  ];
  const distributionCols = [
    { key: "manifestCode",  label: "Manifest" },
    { key: "campaignName",  label: "Campaign" },
    { key: "warehouseName", label: "Warehouse" },
    { key: "status",        label: "Status" },
    { key: "completionPct", label: "Completion %" },
  ];

  const benRows: any[]   = (benReport as any)?.rows ?? [];
  const summary: any     = (benReport as any)?.summary ?? {};
  const stockList: any[] = Array.isArray(stockRows) ? stockRows : [];
  const distList: any[]  = Array.isArray(distRows)  ? distRows  : [];
  const incList: any[]   = incData?.data ?? [];
  const incTotal: number = incData?.total ?? 0;
  const incTotalPages    = Math.max(1, Math.ceil(incTotal / 30));
  const maxDistrictVal   = Math.max(1, ...benRows.map((r: any) => r.total));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Comprehensive operational data across all modules."
      />

      <Tabs defaultValue="beneficiary">
        <TabsList className="h-8">
          <TabsTrigger value="beneficiary"   className="text-xs">Beneficiaries</TabsTrigger>
          <TabsTrigger value="stock"         className="text-xs">Stock Movement</TabsTrigger>
          <TabsTrigger value="distribution"  className="text-xs">Distribution</TabsTrigger>
          <TabsTrigger value="incidents"     className="text-xs">Incidents</TabsTrigger>
        </TabsList>

        {/* ── Beneficiary tab ── */}
        <TabsContent value="beneficiary" className="mt-4 space-y-4">
          {loadingBen ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
            </div>
          ) : benReport ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Farmers" value={summary.total ?? 0}    icon={Users}      color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
              <KpiCard label="Approved"       value={summary.approved ?? 0} icon={TrendingUp}  color="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" />
              <KpiCard label="Female Farmers" value={summary.female ?? 0}   icon={Users}      color="bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" />
              <KpiCard label="Approval Rate"  value={`${summary.pctApproved ?? 0}%`} icon={TrendingUp} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
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
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={!benRows.length}
                onClick={() => downloadCSV(benRows, beneficiaryCols, `beneficiaries-${today}.csv`)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">District</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Approved</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Pending</TableHead>
                    <TableHead className="text-right pr-4 hidden lg:table-cell">Female</TableHead>
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
                          <TableCell className="hidden lg:table-cell pr-4"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
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
                          <TableCell className="text-right text-sm text-muted-foreground pr-4 hidden lg:table-cell tabular-nums">{row.female}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">No beneficiary data</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Stock movement tab ── */}
        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 space-y-2">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Stock Movement Ledger</CardTitle>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={!stockList.length}
                  onClick={() => downloadCSV(stockList, stockCols, `stock-movement-${today}.csv`)}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
              <DateRangeFilter
                from={stockFrom} to={stockTo}
                onFrom={(v) => setStockFrom(v)} onTo={(v) => setStockTo(v)}
                onClear={() => { setStockFrom(""); setStockTo(""); }}
              />
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

        {/* ── Distribution tab ── */}
        <TabsContent value="distribution" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 space-y-2">
              <div className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Distribution Manifests</CardTitle>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={!distList.length}
                  onClick={() => downloadCSV(distList, distributionCols, `distribution-${today}.csv`)}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
              <DateRangeFilter
                from={distFrom} to={distTo}
                onFrom={(v) => setDistFrom(v)} onTo={(v) => setDistTo(v)}
                onClear={() => { setDistFrom(""); setDistTo(""); }}
              />
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
                          <TableCell className="pr-4">
                            <CompletionBar pct={row.completionPct ?? 0} />
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <Package className="h-8 w-8 opacity-30" />
                              <span className="text-sm">
                                {(distFrom || distTo) ? "No dispatches in this date range" : "No distribution data yet"}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Incidents tab ── */}
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
              {!loadingInc && (
                <span className="text-xs text-muted-foreground ml-auto">{incTotal} incidents</span>
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
                  {loadingInc
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                          <TableCell className="hidden sm:table-cell pr-4"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : incList.length > 0
                    ? incList.map((inc: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{inc.incidentCode}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              <span className="text-sm">{inc.type}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{inc.officerName ?? inc.reportedBy ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{inc.location || "—"}</TableCell>
                          <TableCell><StatusBadge status={inc.status} /></TableCell>
                          <TableCell className="pr-4 text-right text-xs text-muted-foreground hidden sm:table-cell">
                            {inc.createdAt ? new Date(inc.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <AlertTriangle className="h-8 w-8 opacity-30" />
                              <span className="text-sm">{incStatus ? `No ${incStatus.toLowerCase()} incidents` : "No incidents reported yet"}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
              {incTotal > 30 && (
                <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                  <span>Page {incPage} of {incTotalPages}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={incPage <= 1} onClick={() => setIncPage(p => p - 1)}>
                      <Clock className="h-4 w-4 rotate-180" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={incPage >= incTotalPages} onClick={() => setIncPage(p => p + 1)}>
                      <Clock className="h-4 w-4" />
                    </Button>
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
