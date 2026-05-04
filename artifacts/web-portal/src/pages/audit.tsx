import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAuditLogs, KEYS } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";

const ACTION_STYLES: Record<string, string> = {
  CREATE:   "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  UPDATE:   "bg-blue-100   text-blue-800   dark:bg-blue-900/30    dark:text-blue-400",
  DELETE:   "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
  APPROVE:  "bg-green-100  text-green-800  dark:bg-green-900/30   dark:text-green-400",
  REJECT:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30  dark:text-orange-400",
  DISPATCH: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30  dark:text-indigo-400",
  ARRIVE:   "bg-teal-100   text-teal-800   dark:bg-teal-900/30    dark:text-teal-400",
  RECEIVE:  "bg-cyan-100   text-cyan-800   dark:bg-cyan-900/30    dark:text-cyan-400",
  LOGIN:    "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
  LOGOUT:   "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
};

const MODULE_STYLES: Record<string, string> = {
  farmers:     "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  inventory:   "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  campaigns:   "bg-blue-50  text-blue-700  dark:bg-blue-900/20  dark:text-blue-400",
  dispatch:    "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
  pod:         "bg-teal-50  text-teal-700  dark:bg-teal-900/20  dark:text-teal-400",
  procurement: "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
};

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_STYLES[action?.toUpperCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {action}
    </span>
  );
}

function ModuleBadge({ module: mod }: { module: string }) {
  const cls = MODULE_STYLES[mod?.toLowerCase()] ?? "bg-slate-50 text-slate-500";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>
      {mod}
    </span>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data: logsData, isLoading } = useQuery({
    queryKey: KEYS.auditLogs(page),
    queryFn: () => listAuditLogs(page, limit),
  });
  const total = logsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">Full system event trail for compliance and debugging.</p>
        </div>
        {!isLoading && total > 0 && (
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">{total.toLocaleString()} events</span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[160px]">Timestamp</TableHead>
                <TableHead className="w-[100px]">Action</TableHead>
                <TableHead className="hidden md:table-cell w-[110px]">Module</TableHead>
                <TableHead className="hidden sm:table-cell w-[120px]">User</TableHead>
                <TableHead className="pr-4">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 12 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-5 w-20 rounded" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-4 w-48" /></TableCell>
                    </TableRow>
                  ))
                : logsData?.data && logsData.data.length > 0
                ? logsData.data.map((log: any) => (
                    <TableRow key={log.id} className="hover:bg-muted/40 align-top">
                      <TableCell className="pl-4">
                        <p className="text-xs tabular-nums">{new Date(log.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                        <p className="text-[10px] text-muted-foreground">{timeAgo(log.createdAt)}</p>
                      </TableCell>
                      <TableCell><ActionBadge action={log.action} /></TableCell>
                      <TableCell className="hidden md:table-cell"><ModuleBadge module={log.module} /></TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{log.username ?? "System"}</TableCell>
                      <TableCell className="pr-4 text-xs max-w-xs truncate" title={log.description}>{log.description}</TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ShieldAlert className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No audit logs found</span>
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
    </div>
  );
}
