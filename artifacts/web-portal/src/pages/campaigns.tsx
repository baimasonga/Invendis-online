import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listCampaigns, deleteCampaign, KEYS } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, ChevronLeft, ChevronRight, Flag, CalendarDays, Pencil, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { CreateCampaignModal } from "@/components/modals/CreateCampaignModal";
import { EditCampaignModal } from "@/components/modals/EditCampaignModal";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

function formatDateRange(start: string, end: string) {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.round((value / total) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
        <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function Campaigns() {
  const can = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const limit = 20;

  const { data: campaignsData, isLoading } = useQuery({
    queryKey: KEYS.campaigns(page),
    queryFn: () => listCampaigns(page, limit),
  });
  const total = campaignsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const deleteMutation = useMutation({ mutationFn: (id: number) => deleteCampaign(id) });

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      await qc.invalidateQueries({ queryKey: KEYS.campaigns() });
      toast({ title: "Campaign deleted", description: `${deleteTarget.name} has been removed.` });
      setDeleteTarget(null);
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        subtitle="Manage distribution campaigns and operations."
        actions={can.createCampaign ? (
          <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New Campaign
          </Button>
        ) : undefined}
      />

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
                <TableHead className="hidden md:table-cell">District / Chain</TableHead>
                <TableHead className="hidden lg:table-cell">Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Progress</TableHead>
                <TableHead className="pr-4 text-right w-[140px]">Actions</TableHead>
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
                ? campaignsData.data.map((campaign: any) => (
                    <TableRow key={campaign.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{campaign.campaignCode}</TableCell>
                      <TableCell className="font-medium text-sm">{campaign.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm">
                        <p>{campaign.districtName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{campaign.valueChainName ?? ""}</p>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {campaign.startDate && campaign.endDate ? (
                          <div className="flex items-center gap-1.5">
                            <CalendarDays className="h-3 w-3 shrink-0" />
                            {formatDateRange(campaign.startDate, campaign.endDate)}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell><StatusBadge status={campaign.status} /></TableCell>
                      <TableCell className="hidden sm:table-cell w-[160px]">
                        <ProgressBar value={campaign.deliveredCount ?? 0} total={campaign.totalFarmers ?? 0} />
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          {can.editCampaign && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50" onClick={() => setEditCampaign(campaign)}>
                              <Pencil className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                          <Link href={`/campaigns/${campaign.id}`}>
                            <span className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline cursor-pointer">View</span>
                          </Link>
                          {can.deleteCampaign && campaign.status === "Draft" && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setDeleteTarget(campaign)}
                              title="Delete campaign"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Flag className="h-8 w-8 opacity-30" />
                          <span className="text-sm">No campaigns yet</span>
                          {can.createCampaign && (
                            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Create first campaign
                            </Button>
                          )}
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

      {can.createCampaign && (
        <CreateCampaignModal open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
      {can.editCampaign && (
        <EditCampaignModal open={!!editCampaign} campaign={editCampaign} onClose={() => setEditCampaign(null)} />
      )}

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> ({deleteTarget?.campaignCode}) will be permanently deleted along with its input items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
