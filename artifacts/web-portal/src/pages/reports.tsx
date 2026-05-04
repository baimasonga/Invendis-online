import { useGetFarmerBeneficiaryReport, useGetStockMovementReport, useGetDistributionReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, ArrowUpDown, MapPin, TrendingUp } from "lucide-react";

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

const GENDER_STYLES: Record<string, string> = {
  female: "bg-pink-100   text-pink-800   dark:bg-pink-900/30    dark:text-pink-400",
  male:   "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  other:  "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
};

const TXN_STYLES: Record<string, string> = {
  receive:      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  transfer_out: "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
  transfer_in:  "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  dispatch:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30  dark:text-indigo-400",
};

export default function Reports() {
  const { data: benReport,   isLoading: loadingBen  } = useGetFarmerBeneficiaryReport();
  const { data: stockReport, isLoading: loadingStock } = useGetStockMovementReport();
  const { data: distReport,  isLoading: loadingDist  } = useGetDistributionReport();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">Comprehensive operational data across all modules.</p>
      </div>

      <Tabs defaultValue="beneficiary">
        <TabsList className="h-8">
          <TabsTrigger value="beneficiary" className="text-xs">Beneficiaries</TabsTrigger>
          <TabsTrigger value="stock" className="text-xs">Stock Movement</TabsTrigger>
          <TabsTrigger value="distribution" className="text-xs">Distribution</TabsTrigger>
        </TabsList>

        {/* Beneficiary tab */}
        <TabsContent value="beneficiary" className="mt-4 space-y-4">
          {loadingBen ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
            </div>
          ) : benReport ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Beneficiaries" value={benReport.totalBeneficiaries ?? 0} icon={Users} color="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" />
              <KpiCard label="Female" value={benReport.female ?? 0} icon={Users} color="bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400" />
              <KpiCard label="Male" value={benReport.male ?? 0} icon={Users} color="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" />
              <KpiCard label="Youth" value={benReport.youth ?? 0} icon={TrendingUp} color="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" />
            </div>
          ) : null}

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Beneficiary List</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Gender</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    <TableHead className="pr-4 hidden lg:table-cell">Value Chain</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingBen
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell className="hidden lg:table-cell pr-4"><Skeleton className="h-4 w-24" /></TableCell>
                        </TableRow>
                      ))
                    : benReport?.rows && benReport.rows.length > 0
                    ? benReport.rows.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{row.farmerCode}</TableCell>
                          <TableCell className="text-sm font-medium">{row.name}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${GENDER_STYLES[row.gender?.toLowerCase()] ?? "bg-slate-100 text-slate-600"}`}>{row.gender}</span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{row.district}</TableCell>
                          <TableCell className="hidden lg:table-cell pr-4 text-sm text-muted-foreground">{row.valueChain}</TableCell>
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

        {/* Stock movement tab */}
        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Stock Movement Ledger</CardTitle>
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
                    : stockReport?.rows && stockReport.rows.length > 0
                    ? stockReport.rows.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4 hidden md:table-cell text-xs text-muted-foreground">
                            {new Date(row.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </TableCell>
                          <TableCell className="pl-4 md:pl-0">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TXN_STYLES[row.transactionType?.toLowerCase().replace(/\s+/g, "_")] ?? "bg-slate-100 text-slate-600"}`}>
                              {row.transactionType}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">{row.inputItem}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{row.warehouse}</TableCell>
                          <TableCell className="pr-4 text-right font-semibold tabular-nums text-sm">{row.quantity}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">No stock movement data</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Distribution tab */}
        <TabsContent value="distribution" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Distribution by District</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">District</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Allocated</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Delivered</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Pending</TableHead>
                    <TableHead className="text-right pr-4">Completion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDist
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    : distReport?.rows && distReport.rows.length > 0
                    ? distReport.rows.map((row: any, i: number) => (
                        <TableRow key={i} className="hover:bg-muted/40">
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium">{row.district}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{row.allocated}</TableCell>
                          <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{row.delivered}</TableCell>
                          <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums text-muted-foreground">{row.pending}</TableCell>
                          <TableCell className="pr-4">
                            <CompletionBar pct={row.completionRate ?? 0} />
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">No distribution data</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
