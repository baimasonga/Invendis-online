import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCampaigns, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight, Flag, CalendarDays } from "lucide-react";
import { Link } from "wouter";
import { CreateCampaignModal } from "@/components/modals/CreateCampaignModal";

const STATUS_STYLES: Record<string, string> = {
  active:    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  approved:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  draft:     "bg-slate-100   text-slate-600   dark:bg-slate-800       dark:text-slate-300",
  pending:   "bg-amber-100   text-amber-800   dark:bg-amber-900/30    dark:text-amber-400",
  submitted: "bg-blue-100    text-blue-800    dark:bg-blue-900/30     dark:text-blue-400",
  completed: "bg-blue-100    text-blue-800    dark:bg-blue-900/30     dark:text-blue-400",
  cancelled: "bg-red-100     text-red-800     dark:bg-red-900/30      dark:text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function formatDateRange(start: string, end: string) {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function Campaigns() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const limit = 20;

  const { data: campaignsData, isLoading } = useQuery({
    queryKey: KEYS.campaigns(page),
    queryFn: () => listCampaigns(page, limit),
  });
  const total = campaignsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Manage distribution campaigns and operations.</p>
        </div>
        <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Campaign
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-0 pt-4 px-4">
          {!isLoading && (
            <p className="text-xs text-muted-foreground">{total.toLocaleString()} campaigns</p>
          )}
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-t">
                <TableHead className="pl-4 w-[130px]">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">District</TableHead>
                <TableHead className="hidden lg:table-cell">Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="pr-4" />
                    </TableRow>
                  ))
                : campaignsData?.data && campaignsData.data.length > 0
                ? campaignsData.data.map((campaign) => (
                    <TableRow key={campaign.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{campaign.campaignCode}</TableCell>
                      <TableCell className="font-medium text-sm">{campaign.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{campaign.districtName ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3 w-3 shrink-0" />
                          {formatDateRange(campaign.startDate, campaign.endDate)}
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge status={campaign.status} /></TableCell>
                      <TableCell className="pr-4 text-right">
                        <Link href={`/campaigns/${campaign.id}`}>
                          <span className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer">View</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Flag className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No campaigns yet</span>
                          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first campaign
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

      <CreateCampaignModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
