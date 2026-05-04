import { useQuery } from "@tanstack/react-query";
import { getDashboardData, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Package, Flag, AlertTriangle,
  Truck, ClipboardList, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell,
} from "recharts";

const COLORS = ["#15803d", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#64748b"];

function StatCard({
  title, value, sub, icon: Icon, accent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{title}</p>
            <p className={`text-2xl font-bold ${accent ?? ""}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent ? "bg-red-100 dark:bg-red-900/30" : "bg-green-100 dark:bg-green-900/30"}`}>
            <Icon className={`h-4 w-4 ${accent ? "text-red-600 dark:text-red-400" : "text-green-700 dark:text-green-400"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const RECENT_ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  UPDATE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  APPROVE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  REJECT: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  DISPATCH: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  RECEIVE: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: KEYS.dashboard(),
    queryFn: getDashboardData,
  });

  const summary = data?.summary;
  const farmerChartData = data?.charts?.farmerStatusChart
    ? data.charts.farmerStatusChart.map((entry: any, i: number) => ({
        ...entry,
        fill: COLORS[i % COLORS.length],
      }))
    : [];
  const activity: any[] = data?.recentActivity ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Field operations at a glance</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard title="Total Farmers"     value={Number(summary.totalFarmers).toLocaleString()}    sub={`${Number(summary.pendingFarmers)} pending`}  icon={Users} />
            <StatCard title="Active Campaigns"  value={summary.activeCampaigns}                           sub="Ongoing distributions"                        icon={Flag} />
            <StatCard title="Pending PoD"       value={summary.pendingPod}                                sub="Awaiting verification"                        icon={ClipboardList} accent={summary.pendingPod > 0 ? "text-destructive" : undefined} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard title="Total Dispatches"  value={Number(summary.totalDispatches).toLocaleString()} sub="All time"                                      icon={Truck} />
            <StatCard title="Total Allocations" value={Number(summary.totalAllocations).toLocaleString()} sub="All campaigns"                                icon={Package} />
          </div>
        </>
      ) : null}

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
                    {farmerChartData.map((entry: any) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
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
              <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
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
