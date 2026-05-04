import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCampaign,
  useSubmitCampaign,
  useApproveCampaign,
  useListAllocations,
  getGetCampaignQueryKey,
  getListCampaignsQueryKey,
  getListAllocationsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CalendarDays, MapPin, Sprout, Users, Send, CheckCircle2, Plus, UserCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddAllocationModal } from "@/components/modals/AddAllocationModal";

const STATUS_STYLES: Record<string, string> = {
  active:    "bg-emerald-100 text-emerald-800 border border-emerald-200",
  approved:  "bg-emerald-100 text-emerald-800 border border-emerald-200",
  draft:     "bg-slate-100   text-slate-600   border border-slate-200",
  pending:   "bg-amber-100   text-amber-800   border border-amber-200",
  submitted: "bg-blue-100    text-blue-800    border border-blue-200",
  completed: "bg-blue-100    text-blue-800    border border-blue-200",
  cancelled: "bg-red-100     text-red-800     border border-red-200",
};

function Field({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: React.ElementType }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function CampaignDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { data: campaign, isLoading } = useGetCampaign(id, {
    query: { enabled: !!id, queryKey: getGetCampaignQueryKey(id) },
  });
  const { data: allocations } = useListAllocations(
    { campaignId: id } as any,
    { query: { enabled: !!id, queryKey: getListAllocationsQueryKey({ campaignId: id } as any) } },
  );

  const submitCampaign = useSubmitCampaign();
  const approveCampaign = useApproveCampaign();

  async function handleAction(action: "submit" | "approve") {
    setActionLoading(true);
    try {
      if (action === "submit") {
        await submitCampaign.mutateAsync({ id });
      } else {
        await approveCampaign.mutateAsync({ id });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListCampaignsQueryKey() }),
      ]);
      toast({ title: action === "submit" ? "Campaign submitted for approval" : "Campaign approved" });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(false); }
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2"><Skeleton className="h-52 w-full rounded-xl" /></div>
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <span>Campaign not found.</span>
        <Link href="/campaigns"><Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button></Link>
      </div>
    );
  }

  const status = (campaign.status ?? "").toLowerCase();
  const allocationList = (allocations as any)?.data ?? (Array.isArray(allocations) ? allocations : []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/campaigns">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{campaign.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{campaign.campaignCode}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
            {campaign.status}
          </span>
          {status === "draft" && (
            <Button size="sm" className="h-7 text-xs" variant="outline" disabled={actionLoading} onClick={() => handleAction("submit")}>
              <Send className="h-3.5 w-3.5 mr-1" /> Submit
            </Button>
          )}
          {status === "submitted" && (
            <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" disabled={actionLoading} onClick={() => handleAction("approve")}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList className="h-8">
          <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
          <TabsTrigger value="farmers" className="text-xs">
            Farmers
            {allocationList.length > 0 && (
              <span className="ml-1.5 rounded-full bg-green-100 text-green-800 text-xs px-1.5 py-0.5 font-medium">{allocationList.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 space-y-5">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">Campaign Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <Field label="District"    value={(campaign as any).districtName}   icon={MapPin} />
                  <Field label="Value Chain" value={(campaign as any).valueChainName} icon={Sprout} />
                  <Field label="Start Date"  value={new Date(campaign.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} icon={CalendarDays} />
                  <Field label="End Date"    value={new Date(campaign.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} />
                  {campaign.description && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Description</p>
                      <p className="text-sm">{campaign.description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Target Farmers</span>
                    <span className="font-semibold">{(campaign as any).totalFarmers ?? allocationList.length}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground">Allocated</span>
                    <span className="font-semibold">{allocationList.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Delivered</span>
                    <span className="font-semibold text-emerald-700">{(campaign as any).deliveredCount ?? 0}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="farmers" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Allocated Farmers</CardTitle>
              <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setAllocationOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Farmer
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {allocationList.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <UserCheck className="h-8 w-8 opacity-30" />
                  <span className="text-sm">No farmers allocated yet</span>
                  <Button size="sm" variant="outline" onClick={() => setAllocationOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add first farmer
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4 w-[120px]">Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">District</TableHead>
                      <TableHead className="pr-4 text-right hidden md:table-cell">Allocated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocationList.map((a: any) => (
                      <TableRow key={a.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{a.farmerCode ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium">{a.farmerName || (`${a.firstName ?? ""} ${a.lastName ?? ""}`.trim()) || "—"}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.districtName ?? "—"}</TableCell>
                        <TableCell className="pr-4 text-right text-xs text-muted-foreground hidden md:table-cell">
                          {a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddAllocationModal open={allocationOpen} onClose={() => setAllocationOpen(false)} campaignId={id} />
    </div>
  );
}
