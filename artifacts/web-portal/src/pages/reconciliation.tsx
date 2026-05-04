import { useListReconciliations } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCcw, TrendingUp, TrendingDown, Minus } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  pending:  "bg-amber-100  text-amber-800  dark:bg-amber-900/30   dark:text-amber-400",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100    text-red-800    dark:bg-red-900/30     dark:text-red-400",
  draft:    "bg-slate-100  text-slate-600  dark:bg-slate-800      dark:text-slate-300",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function Variance({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <Minus className="h-3.5 w-3.5" /> 0
      </span>
    );
  }
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 dark:text-blue-400">
        <TrendingUp className="h-3.5 w-3.5" />+{value}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-700 dark:text-red-400">
      <TrendingDown className="h-3.5 w-3.5" />{value}
    </span>
  );
}

export default function Reconciliation() {
  const { data: recordsData, isLoading } = useListReconciliations({});
  const records = Array.isArray(recordsData) ? recordsData as any[] : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Stock Reconciliation</h1>
          <p className="text-sm text-muted-foreground">Post-dispatch stock reconciliation and variance analysis.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Reconciliation
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 w-[130px]">Code</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right hidden md:table-cell">Loaded</TableHead>
                <TableHead className="text-right hidden md:table-cell">Delivered</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Returned</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                      <TableCell className="pr-4"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    </TableRow>
                  ))
                : records.length > 0
                ? records.map((r: any) => (
                    <TableRow key={r.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{r.reconciliationCode}</TableCell>
                      <TableCell className="font-medium text-sm">{r.campaignName ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{r.totalLoaded ?? 0}</TableCell>
                      <TableCell className="hidden md:table-cell text-right text-sm tabular-nums">{r.totalDelivered ?? 0}</TableCell>
                      <TableCell className="hidden lg:table-cell text-right text-sm tabular-nums">{r.totalReturned ?? 0}</TableCell>
                      <TableCell className="text-right"><Variance value={r.variance ?? 0} /></TableCell>
                      <TableCell className="pr-4"><StatusBadge status={r.status} /></TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <RefreshCcw className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No reconciliation records found</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
