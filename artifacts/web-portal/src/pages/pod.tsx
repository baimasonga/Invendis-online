import { useState } from "react";
import { useListPod, useGetPodStats } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ClipboardCheck, CheckCircle2, Clock, AlertCircle } from "lucide-react";

const STATUS_STYLES: Record<string, { cls: string; icon: React.ElementType }> = {
  verified:  { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2 },
  pending:   { cls: "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",   icon: Clock },
  exception: { cls: "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",     icon: AlertCircle },
};

function StatusBadge({ status }: { status: string }) {
  const key = status?.toLowerCase();
  const { cls, icon: Icon } = STATUS_STYLES[key] ?? { cls: "bg-slate-100 text-slate-600", icon: ClipboardCheck };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

export default function ProofOfDelivery() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data: podData, isLoading } = useListPod({ page });
  const { data: stats } = useGetPodStats();
  const total = podData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Proof of Delivery</h1>
        <p className="text-sm text-muted-foreground">Delivery verifications and exception management.</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{(stats as any).verified ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Verified</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{(stats as any).pending ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertCircle className="h-4 w-4 text-red-700 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{(stats as any).exceptions ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Exceptions</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[130px]">PoD Code</TableHead>
                <TableHead>Farmer</TableHead>
                <TableHead className="hidden md:table-cell">Campaign</TableHead>
                <TableHead className="hidden lg:table-cell">Input</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right hidden md:table-cell">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden md:table-cell pr-4"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    </TableRow>
                  ))
                : podData?.data && podData.data.length > 0
                ? podData.data.map((pod) => (
                    <TableRow key={pod.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{pod.podCode}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{pod.farmerName}</p>
                        <p className="text-xs text-muted-foreground">{pod.farmerCode}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{pod.campaignName}</TableCell>
                      <TableCell className="hidden lg:table-cell text-sm">
                        <span className="font-medium">{pod.quantityDelivered}</span>
                        <span className="text-muted-foreground"> × {pod.inputItemName}</span>
                      </TableCell>
                      <TableCell><StatusBadge status={pod.status} /></TableCell>
                      <TableCell className="hidden md:table-cell pr-4 text-right text-xs text-muted-foreground">
                        {new Date(pod.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <ClipboardCheck className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No delivery records found</span>
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
