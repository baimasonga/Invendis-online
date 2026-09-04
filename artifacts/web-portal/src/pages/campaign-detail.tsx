import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCampaign, submitCampaign, approveCampaign, listAllocations, removeAllocation, addCampaignItem, removeCampaignItem, listInputItems, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CalendarDays, MapPin, Sprout, Users, Send, CheckCircle2, Plus, UserCheck, TrendingUp, Trash2, Package } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { AddAllocationModal } from "@/components/modals/AddAllocationModal";

function DeliveryProgress({ delivered, allocated }: { delivered: number; allocated: number }) {
  const pct = allocated > 0 ? Math.min(100, Math.round((delivered / allocated) * 100)) : 0;
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Delivery progress</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{delivered} delivered</span>
        <span>{allocated} allocated</span>
      </div>
    </div>
  );
}

// An undated campaign (common for imported ones) must not render as 1970.
function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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
  const can = usePermissions();
  const [allocationOpen, setAllocationOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [selectedInputItemId, setSelectedInputItemId] = useState<string>("none");
  const [removeItemTarget, setRemoveItemTarget] = useState<any>(null);

  const removeMutation = useMutation({
    mutationFn: (allocationId: number) => removeAllocation(allocationId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.allocations(undefined, id) }),
        qc.invalidateQueries({ queryKey: KEYS.campaign(id) }),
      ]);
      toast({ title: "Farmer removed", description: `${removeTarget?.farmerName ?? "Farmer"} has been removed from this campaign.` });
      setRemoveTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Remove failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: campaign, isLoading } = useQuery({
    queryKey: KEYS.campaign(id),
    queryFn: () => getCampaign(id),
    enabled: !!id,
  });
  const { data: allocations } = useQuery({
    queryKey: KEYS.allocations(undefined, id),
    queryFn: () => listAllocations(1, 200, id),
    enabled: !!id,
  });

  const submitMutation  = useMutation({ mutationFn: () => submitCampaign(id) });
  const approveMutation = useMutation({ mutationFn: () => approveCampaign(id) });

  const { data: allInputItems } = useQuery({
    queryKey: KEYS.inventory(),
    queryFn: listInputItems,
  });

  const addItemMutation = useMutation({
    mutationFn: (inputItemId: number) => addCampaignItem(id, inputItemId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.campaign(id) });
      setSelectedInputItemId("none");
      toast({ title: "Item added to campaign" });
    },
    onError: (err: any) => toast({ title: "Failed to add item", description: err.message, variant: "destructive" }),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => removeCampaignItem(itemId, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.campaign(id) });
      toast({ title: "Item removed" });
      setRemoveItemTarget(null);
    },
    onError: (err: any) => toast({ title: "Failed to remove item", description: err.message, variant: "destructive" }),
  });

  async function handleAction(action: "submit" | "approve") {
    setActionLoading(true);
    try {
      if (action === "submit") {
        await submitMutation.mutateAsync();
      } else {
        await approveMutation.mutateAsync();
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.campaign(id) }),
        qc.invalidateQueries({ queryKey: KEYS.campaigns() }),
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

  const c = campaign as any;
  const status = (c.status ?? "").toLowerCase();
  const allocationList = (allocations as any)?.data ?? [];
  const campaignItemsList: any[] = c.campaignItems ?? [];
  const canManageItems = can.manageAllocations;
  const canRemoveFarmer = can.manageAllocations && !["approved", "closed", "completed"].includes(status);

  // Input items not yet added to this campaign
  const usedItemIds = new Set(campaignItemsList.map((ci: any) => ci.inputItemId ?? ci.input_item_id));
  const availableItems = (allInputItems as any[] ?? []).filter((i: any) => !usedItemIds.has(i.id));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/campaigns">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{c.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{c.campaignCode}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <StatusBadge status={c.status} />
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
          <TabsTrigger value="items" className="text-xs">
            Input Items
            {campaignItemsList.length > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 font-medium">{campaignItemsList.length}</span>
            )}
          </TabsTrigger>
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
                  <Field label="District"    value={c.districtName}   icon={MapPin} />
                  <Field label="Value Chain" value={c.valueChainName} icon={Sprout} />
                  <Field label="Start Date"  value={formatDate(c.startDate)} icon={CalendarDays} />
                  <Field label="End Date"    value={formatDate(c.endDate)} />
                  {(c.description ?? c.notes) && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Description</p>
                      <p className="text-sm">{c.description ?? c.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Allocated</span>
                    <span className="font-semibold">{allocationList.length}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground">Target</span>
                    <span className="font-semibold">{c.totalFarmers ?? allocationList.length}</span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-sm text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Delivered</span>
                    <span className="font-semibold text-emerald-700">{c.deliveredCount ?? 0}</span>
                  </div>
                  <DeliveryProgress
                    delivered={c.deliveredCount ?? 0}
                    allocated={c.totalFarmers ?? allocationList.length}
                  />
                </CardContent>
              </Card>

              {/* District breakdown */}
              {(() => {
                const byDistrict: Record<string, { allocated: number; delivered: number }> = {};
                for (const a of allocationList) {
                  const d = a.districtName ?? "Unknown";
                  if (!byDistrict[d]) byDistrict[d] = { allocated: 0, delivered: 0 };
                  byDistrict[d].allocated++;
                  if ((a.status ?? "").toLowerCase() === "delivered") byDistrict[d].delivered++;
                }
                const districts = Object.entries(byDistrict).sort((x, y) => y[1].allocated - x[1].allocated);
                if (districts.length <= 1) return null;
                return (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" /> By District
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 pb-1">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="pl-4 py-1.5 text-left font-medium text-muted-foreground">District</th>
                            <th className="pr-2 py-1.5 text-right font-medium text-muted-foreground">Alloc.</th>
                            <th className="pr-4 py-1.5 text-right font-medium text-muted-foreground">Delivered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {districts.map(([district, { allocated, delivered }]) => {
                            const pct = allocated > 0 ? Math.round((delivered / allocated) * 100) : 0;
                            return (
                              <tr key={district} className="border-t">
                                <td className="pl-4 py-2 text-muted-foreground truncate max-w-[100px]">{district}</td>
                                <td className="pr-2 py-2 text-right tabular-nums">{allocated}</td>
                                <td className="pr-4 py-2 text-right tabular-nums">
                                  <span className={delivered > 0 ? "text-emerald-700 font-medium" : "text-muted-foreground"}>
                                    {delivered}
                                  </span>
                                  <span className="text-muted-foreground ml-1">({pct}%)</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" /> Input Items
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Items configured here appear on every allocation in this campaign.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add item row */}
              {canManageItems && (
                <div className="flex gap-2 items-center">
                  <Select value={selectedInputItemId} onValueChange={setSelectedInputItemId}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Select an input item to add…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled>Select an input item…</SelectItem>
                      {availableItems.map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}{item.unit ? ` (${item.unit})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-green-700 hover:bg-green-800 text-white shrink-0"
                    disabled={selectedInputItemId === "none" || addItemMutation.isPending}
                    onClick={() => addItemMutation.mutate(Number(selectedInputItemId))}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Item
                  </Button>
                </div>
              )}

              {/* Items list */}
              {campaignItemsList.length === 0 ? (
                <div className="h-28 flex flex-col items-center justify-center gap-2 text-muted-foreground border rounded-lg">
                  <Package className="h-7 w-7 opacity-30" />
                  <span className="text-sm">No input items configured yet</span>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4">Item Name</TableHead>
                      <TableHead>Unit</TableHead>
                      {canManageItems && <TableHead className="w-[48px] pr-3" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignItemsList.map((ci: any) => (
                      <TableRow key={ci.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 text-sm font-medium">{ci.inputItemName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{ci.unit ?? "—"}</TableCell>
                        {canManageItems && (
                          <TableCell className="pr-3 text-right">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                              title="Remove item"
                              disabled={removeItemMutation.isPending}
                              onClick={() => setRemoveItemTarget(ci)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
                      <TableHead className="text-right hidden md:table-cell">Allocated</TableHead>
                      {canRemoveFarmer && <TableHead className="w-[48px] pr-3" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocationList.map((a: any) => (
                      <TableRow key={a.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{a.farmerCode ?? "—"}</TableCell>
                        <TableCell className="text-sm font-medium">
                          {a.farmerId ? (
                            <Link href={`/farmers/${a.farmerId}`} className="hover:underline text-foreground">
                              {a.farmerName || "—"}
                            </Link>
                          ) : (a.farmerName || "—")}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.districtName ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground hidden md:table-cell">
                          {a.createdAt ? new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                        </TableCell>
                        {canRemoveFarmer && (
                          <TableCell className="pr-3 text-right">
                            <Button
                              size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                              title="Remove from campaign"
                              disabled={removeMutation.isPending}
                              onClick={() => setRemoveTarget(a)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
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

      {/* Remove input item dialog */}
      <AlertDialog open={!!removeItemTarget} onOpenChange={(v) => { if (!v) setRemoveItemTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove input item?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeItemTarget?.inputItemName}</strong> will be removed from this campaign. Existing allocation records will show "None configured" until another item is added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeItemMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={removeItemMutation.isPending}
              onClick={() => removeItemTarget && removeItemMutation.mutate(removeItemTarget.id)}
            >
              {removeItemMutation.isPending ? "Removing…" : "Remove item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove farmer from campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.farmerName}</strong> will be removed from this campaign. Any PoDs already submitted for this farmer will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={removeMutation.isPending}
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
            >
              {removeMutation.isPending ? "Removing…" : "Remove farmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
