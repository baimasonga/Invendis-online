import { useQuery } from "@tanstack/react-query";
import { getDashboardData, KEYS } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Users, Package, Flag, Truck, ClipboardList, Activity,
  UserPlus, ClipboardCheck, TrendingUp, ArrowRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, PieChart, Pie, Legend,
} from "recharts";
import { Link } from "wouter";

const COLORS     = ["#15803d", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#64748b"];
const PIE_COLORS = ["#15803d", "#f59e0b", "#3b82f6", "#8b5cf6", "#ef4444", "#64748b"];

type CardColor = "green" | "amber" | "blue" | "red" | "violet" | "slate";

const COLOR_MAP: Record<CardColor, { border: string; iconBg: string; iconText: string }> = {
  green:  { border: "border-l-emerald-500", iconBg: "bg-emerald-100 dark:bg-emerald-900/30", iconText: "text-emerald-700 dark:text-emerald-400" },
  amber:  { border: "border-l-amber-400",   iconBg: "bg-amber-100   dark:bg-amber-900/30",   iconText: "text-amber-700   dark:text-amber-400"   },
  blue:   { border: "border-l-blue-500",    iconBg: "bg-blue-100    dark:bg-blue-900/30",    iconText: "text-blue-700    dark:text-blue-400"    },
  red:    { border: "border-l-red-500",     iconBg: "bg-red-100     dark:bg-red-900/30",     iconText: "text-red-700     dark:text-red-400"     },
  violet: { border: "border-l-violet-500",  iconBg: "bg-violet-100  dark:bg-violet-900/30",  iconText: "text-violet-700  dark:text-violet-400"  },
  slate:  { border: "border-l-slate-400",   iconBg: "bg-slate-100   dark:bg-slate-800",      iconText: "text-slate-500   dark:text-slate-400"   },
};

function StatCard({
  title, value, sub, icon: Icon, color = "green",
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: CardColor;
}) {
  const c = COLOR_MAP[color];
  return (
    <Card className={`border-l-4 ${c.border} relative overflow-hidden`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 truncate">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${c.iconBg}`}>
            <Icon className={`h-5 w-5 ${c.iconText}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
  { label: "Register Farmer", href: "/farmers",  icon: UserPlus,      color: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  { label: "New Dispatch",    href: "/dispatch",  icon: Truck,         color: "bg-blue-50   text-blue-700   border-blue-200   hover:bg-blue-100"   },
  { label: "Review PoDs",     href: "/pod",        icon: ClipboardCheck,color: "bg-amber-50  text-amber-700  border-amber-200  hover:bg-amber-100"  },
  { label: "View Reports",    href: "/reports",   icon: TrendingUp,    color: "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: KEYS.dashboard(),
    queryFn: getDashboardData,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user as any)?.fullName?.split(" ")[0] ?? (user as any)?.username ?? "";

  const summary          = data?.summary;
  const farmerChartData  = (data?.charts?.farmerStatusChart ?? []).map((e: any, i: number) => ({ ...e, fill: COLORS[i % COLORS.length] }));
  const campaignChartData: any[] = data?.charts?.campaignCompletionChart ?? [];
  const warehouseStockData: any[] = data?.charts?.warehouseStockChart ?? [];
  const podTrendData: any[]       = data?.charts?.podTrendChart ?? [];
  const activity: any[]           = data?.recentActivity ?? [];

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
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full self-start sm:self-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
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

      {/* Stat cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
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
            sub={`${Number(summary.pendingFarmers)} pending approval`}
            icon={Users}
            color="green"
          />
          <StatCard
            title="Active Campaigns"
            value={summary.activeCampaigns}
            sub="Ongoing distributions"
            icon={Flag}
            color="blue"
          />
          <StatCard
            title="Pending PoD"
            value={summary.pendingPod}
            sub="Awaiting verification"
            icon={ClipboardList}
            color={summary.pendingPod > 0 ? "red" : "green"}
          />
          <StatCard
            title="Total Dispatches"
            value={Number(summary.totalDispatches).toLocaleString()}
            sub="All time"
            icon={Truck}
            color="violet"
          />
          <StatCard
            title="Total Allocations"
            value={Number(summary.totalAllocations).toLocaleString()}
            sub="All campaigns"
            icon={Package}
            color="amber"
          />
        </div>
      ) : null}

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

      {/* Charts row 2: Warehouse + Campaigns + Recent Activity */}
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
