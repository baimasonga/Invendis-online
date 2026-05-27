import { useQuery } from "@tanstack/react-query";
import { getDashboardData, KEYS } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users, Package, Flag, Truck, ClipboardList, Activity,
  UserPlus, ClipboardCheck, TrendingUp, TrendingDown, ArrowRight,
  AlertTriangle, Minus, PackageOpen,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie, Legend,
} from "recharts";
import { Link } from "wouter";

const COLORS     = ["#15803d", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#64748b"];
const PIE_COLORS = ["#15803d", "#f59e0b", "#3b82f6", "#8b5cf6", "#ef4444", "#64748b"];

type CardColor = "green" | "amber" | "blue" | "red" | "violet" | "slate";
type Trend = { pct: number; dir: "up" | "down" | "flat" };

const COLOR_MAP: Record<CardColor, { border: string; iconBg: string; iconText: string }> = {
  green:  { border: "border-l-emerald-500", iconBg: "bg-emerald-100 dark:bg-emerald-900/30", iconText: "text-emerald-700 dark:text-emerald-400" },
  amber:  { border: "border-l-amber-400",   iconBg: "bg-amber-100   dark:bg-amber-900/30",   iconText: "text-amber-700   dark:text-amber-400"   },
  blue:   { border: "border-l-blue-500",    iconBg: "bg-blue-100    dark:bg-blue-900/30",    iconText: "text-blue-700    dark:text-blue-400"    },
  red:    { border: "border-l-red-500",     iconBg: "bg-red-100     dark:bg-red-900/30",     iconText: "text-red-700     dark:text-red-400"     },
  violet: { border: "border-l-violet-500",  iconBg: "bg-violet-100  dark:bg-violet-900/30",  iconText: "text-violet-700  dark:text-violet-400"  },
  slate:  { border: "border-l-slate-400",   iconBg: "bg-slate-100   dark:bg-slate-800",      iconText: "text-slate-500   dark:text-slate-400"   },
};

function TrendBadge({ trend }: { trend: Trend }) {
  if (trend.dir === "flat") return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400">
      <Minus className="h-2.5 w-2.5" /> No change vs last week
    </span>
  );
  const up = trend.dir === "up";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${up ? "text-emerald-600" : "text-red-500"}`}>
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {up ? "+" : "−"}{trend.pct}% vs last week
    </span>
  );
}

function StatCard({
  title, value, sub, icon: Icon, color = "green", href, trend,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: CardColor; href?: string; trend?: Trend | null;
}) {
  const c = COLOR_MAP[color];
  const card = (
    <Card className={`border-l-4 ${c.border} relative overflow-hidden${href ? " cursor-pointer hover:shadow-md transition-shadow" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 truncate">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {trend && <div className="mt-1"><TrendBadge trend={trend} /></div>}
            {sub && <p className="text-xs text-muted-foreground mt-1 leading-snug">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.iconBg}`}>
            <Icon className={`h-5 w-5 ${c.iconText}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="block">{card}</Link> : card;
}

const RECENT_ACTION_COLORS: Record<string, string> = {
  CREATE:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  UPDATE:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  DELETE:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  APPROVE:  "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  REJECT:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  DISPATCH: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  RECEIVE:  "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const QUICK_ACTIONS = [
  { label: "Register Farmer", href: "/farmers",  icon: UserPlus,       color: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  { label: "New Dispatch",    href: "/dispatch",  icon: Truck,          color: "bg-blue-50   text-blue-700   border-blue-200   hover:bg-blue-100"   },
  { label: "Review PoDs",     href: "/pod",       icon: ClipboardCheck, color: "bg-amber-50  text-amber-700  border-amber-200  hover:bg-amber-100"  },
  { label: "View Reports",    href: "/reports",   icon: TrendingUp,     color: "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100" },
];

function CampaignProgressBar({ pct, delivered, target }: { pct: number; delivered: number; target: number }) {
  const color = pct >= 80 ? "#15803d" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{delivered.toLocaleString()} delivered</span>
        <span className="font-medium" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">Target: {target.toLocaleString()} farmers</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: KEYS.dashboard(),
    queryFn: getDashboardData,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user as any)?.fullName?.split(" ")[0] ?? (user as any)?.username ?? "";

  const summary               = data?.summary;
  const trends                = data?.trends;
  const campaignProgress: any[] = data?.campaignProgress ?? [];
  const stockAlerts: any[]    = data?.stockAlerts ?? [];
  const farmerChartData       = (data?.charts?.farmerStatusChart ?? []).map((e: any, i: number) => ({ ...e, fill: COLORS[i % COLORS.length] }));
  const campaignChartData: any[]    = data?.charts?.campaignCompletionChart ?? [];
  const warehouseStockData: any[]   = data?.charts?.warehouseStockChart ?? [];
  const podTrendData: any[]         = data?.charts?.podTrendChart ?? [];
  const districtData: any[]         = data?.charts?.farmersByDistrictChart ?? [];
  const beneficiaryData: any[]      = (data?.charts?.beneficiaryTypeChart ?? []).map((e: any, i: number) => ({ ...e, fill: PIE_COLORS[i % PIE_COLORS.length] }));
  const activity: any[]             = data?.recentActivity ?? [];

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {greeting}{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what's happening in the field today.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {(user as any)?.role && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 capitalize">
              {(user as any).role.replace(/([A-Z])/g, " $1").trim()}
            </span>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {QUICK_ACTIONS.map(({ label, href, icon: Icon, color }) => (
          <Link key={href} href={href}>
            <div className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border cursor-pointer transition-colors ${color}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-xs font-medium leading-tight">{label}</span>
              <ArrowRight className="h-3 w-3 ml-auto shrink-0 opacity-50" />
            </div>
          </Link>
        ))}
      </div>

      {/* Stock alerts */}
      {!isLoading && stockAlerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Low Stock Alerts</h2>
            <span className="text-xs text-muted-foreground">— items below 50 units</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stockAlerts.map((a: any) => (
              <Link key={a.id} href="/inventory">
                <Card className="border-l-4 border-l-amber-400 cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{a.itemName}</p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{a.warehouseName}</p>
                      </div>
                      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${a.available === 0 ? "bg-red-100" : "bg-amber-100"}`}>
                        <PackageOpen className={`h-4 w-4 ${a.available === 0 ? "text-red-600" : "text-amber-600"}`} />
                      </div>
                    </div>
                    <p className={`text-xl font-bold tabular-nums mt-2 ${a.available === 0 ? "text-red-600" : "text-amber-600"}`}>
                      {a.available.toLocaleString()}
                      <span className="text-xs font-normal text-muted-foreground ml-1">{a.unit}</span>
                    </p>
                    <p className={`text-[10px] font-medium mt-0.5 ${a.available === 0 ? "text-red-500" : "text-amber-500"}`}>
                      {a.available === 0 ? "Out of stock" : "Low stock — reorder needed"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-l-4 border-l-muted">
              <CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total Farmers"
            value={Number(summary.totalFarmers).toLocaleString()}
            sub={`${Number(summary.pendingFarmers)} pending · ${summary.femalePct ?? 0}% female`}
            icon={Users}
            color="green"
            href="/farmers"
            trend={trends?.farmers}
          />
          <StatCard
            title="Active Campaigns"
            value={summary.activeCampaigns}
            sub="Ongoing distributions"
            icon={Flag}
            color="blue"
            href="/campaigns"
          />
          <StatCard
            title="Pending PoD"
            value={summary.pendingPod}
            sub="Awaiting verification"
            icon={ClipboardList}
            color={summary.pendingPod > 0 ? "red" : "green"}
            href="/pod"
            trend={trends?.pod}
          />
          <StatCard
            title="Total Dispatches"
            value={Number(summary.totalDispatches).toLocaleString()}
            sub="All time"
            icon={Truck}
            color="violet"
            href="/dispatch"
            trend={trends?.dispatches}
          />
          <StatCard
            title="Total Allocations"
            value={Number(summary.totalAllocations).toLocaleString()}
            sub="All campaigns"
            icon={Package}
            color="amber"
            href="/allocations"
          />
          <StatCard
            title="Open Incidents"
            value={summary.openIncidents ?? 0}
            sub={summary.openIncidents > 0 ? "Requires attention" : "All clear"}
            icon={AlertTriangle}
            color={summary.openIncidents > 0 ? "red" : "green"}
            href="/incidents"
          />
        </div>
      ) : null}

      {/* Campaign progress */}
      {!isLoading && campaignProgress.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Flag className="h-4 w-4 text-blue-600" />
              Active Campaign Delivery Progress
            </h2>
            <Link href="/campaigns">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground">
                All campaigns <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {campaignProgress.map((c: any) => (
              <Link key={c.id} href={`/campaigns/${c.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold leading-tight line-clamp-2">{c.name}</p>
                      <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        c.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                      }`}>{c.status}</span>
                    </div>
                    <CampaignProgressBar
                      pct={c.pct}
                      delivered={c.deliveredCount}
                      target={Math.max(c.allocatedFarmers, c.targetBeneficiaries, 1)}
                    />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Charts row 1: Farmers by Status + PoD Trend */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Farmers by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : farmerChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={farmerChartData} layout="vertical" barSize={18}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={62} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {farmerChartData.map((e: any) => <Cell key={e.name} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">PoD Deliveries — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : podTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={podTrendData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="verifiedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#15803d" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#15803d" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="pendingGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="verified" stroke="#15803d" fill="url(#verifiedGrad)" strokeWidth={2} dot={{ r: 3 }} name="Verified" />
                  <Area type="monotone" dataKey="pending"  stroke="#f59e0b" fill="url(#pendingGrad)"  strokeWidth={2} dot={{ r: 3 }} name="Pending" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No PoD data in last 7 days</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: Farmers by District + Beneficiary Type */}
      {(districtData.length > 0 || beneficiaryData.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Farmers by District</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-44 w-full" />
              ) : districtData.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(160, districtData.length * 28)}>
                  <BarChart data={districtData} layout="vertical" barSize={14}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip
                      formatter={(v: any) => [Number(v).toLocaleString(), "Farmers"]}
                      contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }}
                    />
                    <Bar dataKey="farmers" radius={[0, 4, 4, 0]} fill="#15803d" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No farmer data yet</div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Beneficiary Type</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-44 w-full" />
              ) : beneficiaryData.some((d: any) => d.value > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={beneficiaryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={32}>
                      {beneficiaryData.map((e: any, i: number) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No farmer data yet</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts row 3: Warehouse + Campaigns + Recent Activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Campaigns by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : campaignChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={campaignChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={32}>
                    {campaignChartData.map((_: any, i: number) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No campaign data</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Warehouse Stock Levels</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : warehouseStockData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={warehouseStockData} layout="vertical" barSize={14}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={72} />
                  <Tooltip
                    formatter={(v: any) => [Number(v).toLocaleString(), "Units"]}
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #e5e7eb" }}
                  />
                  <Bar dataKey="stock" radius={[0, 4, 4, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No stock data yet</div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : activity.length > 0 ? (
              <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1">
                {activity.slice(0, 12).map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${RECENT_ACTION_COLORS[log.action] ?? "bg-slate-100 text-slate-600"}`}>
                      {log.action}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground truncate leading-tight">{log.description}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{log.username} · {timeAgo(log.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">No recent activity</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
