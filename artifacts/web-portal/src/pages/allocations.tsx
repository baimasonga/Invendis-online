import { useState } from "react";
import { Link } from "wouter";
import { useListAllocations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { NewAllocationModal } from "@/components/modals/NewAllocationModal";

const STATUS_STYLES: Record<string, string> = {
  allocated: "bg-blue-100   text-blue-800   dark:bg-blue-900/30   dark:text-blue-400",
  delivered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  pending:   "bg-amber-100  text-amber-800  dark:bg-amber-900/30  dark:text-amber-400",
  cancelled: "bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>
  );
}

export default function Allocations() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);

  const limit = 20;
  const { data: allocationsData, isLoading } = useListAllocations({ page } as any);
  const rows: any[] = (allocationsData as any)?.data ?? [];
  const total: number = (allocationsData as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Allocations</h1>
          <p className="text-sm text-muted-foreground">Input allocations for farmers across all campaigns.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Allocation
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && <p className="text-xs text-muted-foreground">{total.toLocaleString()} allocations</p>}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4">Farmer</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="hidden md:table-cell">Input Item</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell className="hidden lg:table-cell pr-4"><Skeleton className="h-4 w-20" /></TableCell>
                    </TableRow>
                  ))
                : rows.length > 0
                ? rows.map((a: any) => (
                    <TableRow key={a.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4">
                        <div>
                          <p className="text-sm font-medium">{a.farmerName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{a.farmerCode}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/campaigns/${a.campaignId}`}>
                          <span className="text-sm text-green-700 hover:underline cursor-pointer">{a.campaignName ?? "—"}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.inputItemName ?? "—"}</TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-sm tabular-nums font-medium">{a.quantity ?? "—"}</TableCell>
                      <TableCell><StatusBadge status={a.status ?? "Allocated"} /></TableCell>
                      <TableCell className="pr-4 hidden lg:table-cell text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Users className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No allocations found</span>
                          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first allocation
                          </Button>
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

      <NewAllocationModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
