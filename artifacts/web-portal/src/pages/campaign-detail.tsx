import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCampaign,
  submitCampaign,
  approveCampaign,
  rejectCampaign,
  cancelCampaign,
  completeCampaign,
  listAllocations,
  removeAllocation,
  addCampaignItem,
  updateCampaignItem,
  removeCampaignItem,
  listInputItems,
  listItemTemplates,
  applyItemTemplate,
  getCampaignEntitlements,
  ALLOCATION_BASIS_LABELS,
  type AllocationBasis,
  KEYS,
} from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  CalendarDays,
  MapPin,
  Sprout,
  Users,
  Send,
  CheckCircle2,
  Plus,
  UserCheck,
  TrendingUp,
  Trash2,
  Package,
  Printer,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { AddAllocationModal } from "@/components/modals/AddAllocationModal";
import { DistributionLabelModal } from "@/components/modals/DistributionLabelModal";

function DeliveryProgress({
  delivered,
  allocated,
}: {
  delivered: number;
  allocated: number;
}) {
  const pct =
    allocated > 0
      ? Math.min(100, Math.round((delivered / allocated) * 100))
      : 0;
  const color =
    pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : "bg-amber-500";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Delivery progress</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
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
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value?: string | null;
  icon?: React.ElementType;
}) {
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
  const [selectedInputItemId, setSelectedInputItemId] =
    useState<string>("none");
  const [quantityPerFarmer, setQuantityPerFarmer] = useState("1");
  const [itemBasis, setItemBasis] = useState<AllocationBasis>("per_beneficiary");
  const [templateId, setTemplateId] = useState<string>("none");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [removeItemTarget, setRemoveItemTarget] = useState<any>(null);

  const removeMutation = useMutation({
    mutationFn: (allocationId: number) => removeAllocation(allocationId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.allocations(undefined, id) }),
        qc.invalidateQueries({ queryKey: KEYS.campaign(id) }),
      ]);
      toast({
        title: "Farmer removed",
        description: `${removeTarget?.farmerName ?? "Farmer"} has been removed from this campaign.`,
      });
      setRemoveTarget(null);
    },
    onError: (err: any) => {
      toast({
        title: "Remove failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const { data: campaign, isLoading } = useQuery({
    queryKey: KEYS.campaign(id),
    queryFn: () => getCampaign(id),
    enabled: !!id,
  });
  const { data: allocations } = useQuery({
    queryKey: KEYS.allocations(undefined, id),
    queryFn: () => listAllocations(1, 500, id),
    enabled: !!id,
  });

  const submitMutation = useMutation({ mutationFn: () => submitCampaign(id) });
  const approveMutation = useMutation({
    mutationFn: () => approveCampaign(id),
  });

  const { data: allInputItems } = useQuery({
    queryKey: ["inputItems"],
    queryFn: listInputItems,
  });

  const { data: templates } = useQuery({
    queryKey: KEYS.itemTemplates(),
    queryFn: listItemTemplates,
  });
  const templateList = Array.isArray(templates)
    ? templates.filter((t: any) => Number(t.isActive) === 1)
    : [];

  // What approval will actually try to reserve, given each beneficiary's own
  // group size and farm size.
  const { data: entitlements } = useQuery({
    queryKey: KEYS.campaignEntitlements(id),
    queryFn: () => getCampaignEntitlements(id),
    enabled: !!id,
  });

  const entitlementTotals = Array.isArray((entitlements as any)?.totals)
    ? (entitlements as any).totals
    : [];
  const beneficiaryCount = Array.isArray((entitlements as any)?.beneficiaries)
    ? (entitlements as any).beneficiaries.length
    : 0;

  const addItemMutation = useMutation({
    mutationFn: (inputItemId: number) =>
      addCampaignItem(id, inputItemId, Number(quantityPerFarmer), itemBasis),
    onSuccess: async () => {
      await refreshItems();
      setSelectedInputItemId("none");
      setQuantityPerFarmer("1");
      setItemBasis("per_beneficiary");
      toast({ title: "Item added to campaign" });
    },
    onError: (err: any) =>
      toast({
        title: "Failed to add item",
        description: err.message,
        variant: "destructive",
      }),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => removeCampaignItem(itemId, id),
    onSuccess: async () => {
      await refreshItems();
      toast({ title: "Item removed" });
      setRemoveItemTarget(null);
    },
    onError: (err: any) =>
      toast({
        title: "Failed to remove item",
        description: err.message,
        variant: "destructive",
      }),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({
      itemId,
      quantity,
      basis,
    }: {
      itemId: number;
      quantity: number;
      basis: AllocationBasis;
    }) => updateCampaignItem(id, itemId, quantity, basis),
    onSuccess: async () => {
      await refreshItems();
      toast({ title: "Package line updated" });
    },
    onError: (err: any) =>
      toast({
        title: "Failed to update quantity",
        description: err.message,
        variant: "destructive",
      }),
  });

  // Changing the package changes every beneficiary's entitlement, so the
  // campaign and the reservation preview refresh together.
  async function refreshItems() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: KEYS.campaign(id) }),
      qc.invalidateQueries({ queryKey: KEYS.campaignEntitlements(id) }),
    ]);
  }

  const applyTemplateMutation = useMutation({
    mutationFn: (template: number) => applyItemTemplate(id, template),
    onSuccess: async (result: any) => {
      await refreshItems();
      setTemplateId("none");
      toast({
        title: "Template applied",
        description: `${result?.applied ?? 0} item${result?.applied === 1 ? "" : "s"} now make up this campaign's package.`,
      });
    },
    onError: (err: any) =>
      toast({
        title: "Failed to apply template",
        description: err.message,
        variant: "destructive",
      }),
  });

  function editItemQuantity(item: any) {
    const entered = window.prompt(
      `Rate for ${item.inputItemName ?? "this item"} (${ALLOCATION_BASIS_LABELS[(item.basis ?? "per_beneficiary") as AllocationBasis]}):`,
      String(item.quantityPerFarmer ?? 1),
    );
    if (entered == null) return;
    const quantity = Number(entered);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Enter a number greater than zero.",
        variant: "destructive",
      });
      return;
    }
    updateItemMutation.mutate({
      itemId: item.id,
      quantity,
      basis: (item.basis ?? "per_beneficiary") as AllocationBasis,
    });
  }

  async function handleAction(
    action: "submit" | "approve" | "reject" | "cancel" | "complete",
  ) {
    setActionLoading(true);
    try {
      if (action === "submit") await submitMutation.mutateAsync();
      else if (action === "approve") await approveMutation.mutateAsync();
      else if (action === "complete") await completeCampaign(id);
      else {
        const reason = window.prompt(
          action === "reject"
            ? "Reason for rejection:"
            : "Reason for cancellation:",
        );
        if (!reason?.trim()) return;
        if (action === "reject") await rejectCampaign(id, reason);
        else await cancelCampaign(id, reason);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEYS.campaign(id) }),
        qc.invalidateQueries({ queryKey: KEYS.campaigns() }),
      ]);
      const labels = {
        submit: "submitted",
        approve: "approved",
        reject: "rejected",
        cancel: "cancelled",
        complete: "completed",
      } as const;
      toast({ title: `Campaign ${labels[action]}` });
    } catch (err: any) {
      toast({
        title: "Action failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="md:col-span-2">
            <Skeleton className="h-52 w-full rounded-xl" />
          </div>
          <Skeleton className="h-52 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <span>Campaign not found.</span>
        <Link href="/campaigns">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
          </Button>
        </Link>
      </div>
    );
  }

  const c = campaign as any;
  const status = (c.status ?? "").toLowerCase();
  const allocationList = (allocations as any)?.data ?? [];
  const campaignItemsList: any[] = c.campaignItems ?? [];
  const editable = ["draft", "rejected"].includes(status);
  const canManageItems = can.editCampaign && editable;
  const canRemoveFarmer = can.manageAllocations && editable;

  // Input items not yet added to this campaign
  const usedItemIds = new Set(
    campaignItemsList.map((ci: any) => ci.inputItemId ?? ci.input_item_id),
  );
  const availableItems = ((allInputItems as any[]) ?? []).filter(
    (i: any) => !usedItemIds.has(i.id),
  );

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
          <p className="text-xs text-muted-foreground font-mono">
            {c.campaignCode}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <StatusBadge status={c.status} />
          {can.editCampaign && ["draft", "rejected"].includes(status) && (
            <Button
              size="sm"
              className="h-7 text-xs"
              variant="outline"
              disabled={actionLoading}
              onClick={() => handleAction("submit")}
            >
              <Send className="h-3.5 w-3.5 mr-1" /> Submit
            </Button>
          )}
          {can.editCampaign && status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-700"
                disabled={actionLoading}
                onClick={() => handleAction("reject")}
              >
                Reject
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white"
                disabled={actionLoading}
                onClick={() => handleAction("approve")}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
              </Button>
            </>
          )}
          {can.editCampaign && status === "approved" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-700"
              disabled={actionLoading}
              onClick={() => handleAction("cancel")}
            >
              Cancel
            </Button>
          )}
          {can.editCampaign && status === "active" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={actionLoading}
              onClick={() => handleAction("complete")}
            >
              Complete
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList className="h-8">
          <TabsTrigger value="details" className="text-xs">
            Details
          </TabsTrigger>
          <TabsTrigger value="items" className="text-xs">
            Input Items
            {campaignItemsList.length > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-100 text-blue-800 text-xs px-1.5 py-0.5 font-medium">
                {campaignItemsList.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="farmers" className="text-xs">
            Farmers
            {allocationList.length > 0 && (
              <span className="ml-1.5 rounded-full bg-green-100 text-green-800 text-xs px-1.5 py-0.5 font-medium">
                {allocationList.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 space-y-5">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">
                    Campaign Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <Field
                    label="District"
                    value={c.districtName}
                    icon={MapPin}
                  />
                  <Field
                    label="Value Chain"
                    value={c.valueChainName}
                    icon={Sprout}
                  />
                  <Field label="Season" value={c.season} />
                  <Field
                    label="Delivery Site"
                    value={c.distributionSiteName}
                    icon={MapPin}
                  />
                  <Field
                    label="Source Warehouse"
                    value={c.sourceWarehouseName}
                    icon={Package}
                  />
                  <Field
                    label="Start Date"
                    value={formatDate(c.startDate)}
                    icon={CalendarDays}
                  />
                  <Field label="End Date" value={formatDate(c.endDate)} />
                  {(c.description ?? c.notes) && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Description
                      </p>
                      <p className="text-sm">{c.description ?? c.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">
                    Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> Allocated
                    </span>
                    <span className="font-semibold">
                      {allocationList.length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm text-muted-foreground">
                      Target
                    </span>
                    <span className="font-semibold">
                      {c.totalFarmers ?? allocationList.length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-3 border-b">
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />{" "}
                      Delivered
                    </span>
                    <span className="font-semibold text-emerald-700">
                      {c.deliveredCount ?? 0}
                    </span>
                  </div>
                  <DeliveryProgress
                    delivered={c.deliveredCount ?? 0}
                    allocated={c.allocatedFarmers ?? allocationList.length}
                  />
                </CardContent>
              </Card>

              {/* District breakdown */}
              {(() => {
                const byDistrict: Record<
                  string,
                  { allocated: number; delivered: number }
                > = {};
                for (const a of allocationList) {
                  const d = a.districtName ?? "Unknown";
                  if (!byDistrict[d])
                    byDistrict[d] = { allocated: 0, delivered: 0 };
                  byDistrict[d].allocated++;
                  if ((a.status ?? "").toLowerCase() === "delivered")
                    byDistrict[d].delivered++;
                }
                const districts = Object.entries(byDistrict).sort(
                  (x, y) => y[1].allocated - x[1].allocated,
                );
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
                            <th className="pl-4 py-1.5 text-left font-medium text-muted-foreground">
                              District
                            </th>
                            <th className="pr-2 py-1.5 text-right font-medium text-muted-foreground">
                              Alloc.
                            </th>
                            <th className="pr-4 py-1.5 text-right font-medium text-muted-foreground">
                              Delivered
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {districts.map(
                            ([district, { allocated, delivered }]) => {
                              const pct =
                                allocated > 0
                                  ? Math.round((delivered / allocated) * 100)
                                  : 0;
                              return (
                                <tr key={district} className="border-t">
                                  <td className="pl-4 py-2 text-muted-foreground truncate max-w-[100px]">
                                    {district}
                                  </td>
                                  <td className="pr-2 py-2 text-right tabular-nums">
                                    {allocated}
                                  </td>
                                  <td className="pr-4 py-2 text-right tabular-nums">
                                    <span
                                      className={
                                        delivered > 0
                                          ? "text-emerald-700 font-medium"
                                          : "text-muted-foreground"
                                      }
                                    >
                                      {delivered}
                                    </span>
                                    <span className="text-muted-foreground ml-1">
                                      ({pct}%)
                                    </span>
                                  </td>
                                </tr>
                              );
                            },
                          )}
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
                <Package className="h-4 w-4 text-muted-foreground" /> Input
                Items
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Each line is a rule, not a flat quantity: the rate is multiplied
                by the beneficiary&rsquo;s group size or farm size, so a group of
                twenty receives twenty hoes but a single tractor.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Apply a saved package */}
              {canManageItems && templateList.length > 0 && (
                <div className="flex gap-2 items-center">
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Apply a saved package…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled>
                        Apply a saved package…
                      </SelectItem>
                      {templateList.map((template: any) => (
                        <SelectItem key={template.id} value={String(template.id)}>
                          {template.name}
                          {template.valueChainName
                            ? ` — ${template.valueChainName}`
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    disabled={
                      templateId === "none" || applyTemplateMutation.isPending
                    }
                    onClick={() =>
                      applyTemplateMutation.mutate(Number(templateId))
                    }
                    title="Replaces the current items with the template's"
                  >
                    Apply
                  </Button>
                </div>
              )}

              {/* Add item row */}
              {canManageItems && (
                <div className="flex gap-2 items-center">
                  <Select
                    value={selectedInputItemId}
                    onValueChange={setSelectedInputItemId}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Select an input item to add…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled>
                        Select an input item…
                      </SelectItem>
                      {availableItems.map((item: any) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.name}
                          {item.unit ? ` (${item.unit})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-8 w-20"
                    type="number"
                    min="0.01"
                    step="any"
                    aria-label="Rate"
                    value={quantityPerFarmer}
                    onChange={(e) => setQuantityPerFarmer(e.target.value)}
                  />
                  <Select
                    value={itemBasis}
                    onValueChange={(value) =>
                      setItemBasis(value as AllocationBasis)
                    }
                  >
                    <SelectTrigger
                      className="h-8 text-xs w-40 shrink-0"
                      aria-label="Basis"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(ALLOCATION_BASIS_LABELS) as AllocationBasis[]
                      ).map((basis) => (
                        <SelectItem key={basis} value={basis}>
                          {ALLOCATION_BASIS_LABELS[basis]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-green-700 hover:bg-green-800 text-white shrink-0"
                    disabled={
                      selectedInputItemId === "none" ||
                      Number(quantityPerFarmer) <= 0 ||
                      addItemMutation.isPending
                    }
                    onClick={() =>
                      addItemMutation.mutate(Number(selectedInputItemId))
                    }
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
                      <TableHead>Rate</TableHead>
                      <TableHead>Basis</TableHead>
                      {canManageItems && (
                        <TableHead className="w-[110px] pr-3" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignItemsList.map((ci: any) => (
                      <TableRow key={ci.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 text-sm font-medium">
                          {ci.inputItemName ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {ci.unit ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {ci.quantityPerFarmer ?? 1}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {ALLOCATION_BASIS_LABELS[
                            (ci.basis ?? "per_beneficiary") as AllocationBasis
                          ] ?? ci.basis}
                        </TableCell>
                        {canManageItems && (
                          <TableCell className="pr-3 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-blue-600"
                              title="Edit quantity"
                              disabled={updateItemMutation.isPending}
                              onClick={() => editItemQuantity(ci)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
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

              {/* What approval will try to reserve from the source warehouse. */}
              {entitlementTotals.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold">
                      Total to reserve across {beneficiaryCount} beneficiar
                      {beneficiaryCount === 1 ? "y" : "ies"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {entitlementTotals.map((total: any) => (
                      <span
                        key={total.inputItemId}
                        className="text-xs text-muted-foreground"
                      >
                        {total.name ?? "Item"}{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {Number(total.quantity).toLocaleString()}
                        </span>
                        {total.unit ? ` ${total.unit}` : ""}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Approval fails if the source warehouse cannot cover these
                    quantities, or if a beneficiary is missing the group size or
                    farm size a line depends on.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="farmers" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Allocated Farmers
              </CardTitle>
              <div className="flex items-center gap-2">
                {allocationList.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setLabelsOpen(true)}
                  >
                    <Printer className="h-3.5 w-3.5 mr-1" /> Print Labels
                  </Button>
                )}
                {canRemoveFarmer && (
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white"
                    onClick={() => setAllocationOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Farmer
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {allocationList.length === 0 ? (
                <div className="h-32 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <UserCheck className="h-8 w-8 opacity-30" />
                  <span className="text-sm">No farmers allocated yet</span>
                  {canRemoveFarmer && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAllocationOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add first farmer
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4 w-[120px]">Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">
                        District
                      </TableHead>
                      <TableHead className="text-right hidden md:table-cell">
                        Allocated
                      </TableHead>
                      {canRemoveFarmer && (
                        <TableHead className="w-[48px] pr-3" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocationList.map((a: any) => (
                      <TableRow key={a.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">
                          {a.farmerCode ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {a.farmerId ? (
                            <Link
                              href={`/farmers/${a.farmerId}`}
                              className="hover:underline text-foreground"
                            >
                              {a.farmerName || "—"}
                            </Link>
                          ) : (
                            a.farmerName || "—"
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {a.districtName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground hidden md:table-cell">
                          {a.createdAt
                            ? new Date(a.createdAt).toLocaleDateString(
                                "en-GB",
                                { day: "numeric", month: "short" },
                              )
                            : "—"}
                        </TableCell>
                        {canRemoveFarmer && (
                          <TableCell className="pr-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
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

      <DistributionLabelModal
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        allocations={allocationList}
        contextLabel={`${c.name} · ${c.campaignCode ?? ""}`}
      />

      {canRemoveFarmer && (
        <AddAllocationModal
          open={allocationOpen}
          onClose={() => setAllocationOpen(false)}
          campaignId={id}
          districtId={c.districtId}
          valueChainId={c.valueChainId}
        />
      )}

      {/* Remove input item dialog */}
      <AlertDialog
        open={!!removeItemTarget}
        onOpenChange={(v) => {
          if (!v) setRemoveItemTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove input item?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeItemTarget?.inputItemName}</strong> will be removed
              from this campaign. Existing allocation records will show "None
              configured" until another item is added.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeItemMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={removeItemMutation.isPending}
              onClick={() =>
                removeItemTarget &&
                removeItemMutation.mutate(removeItemTarget.id)
              }
            >
              {removeItemMutation.isPending ? "Removing…" : "Remove item"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(v) => {
          if (!v) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove farmer from campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeTarget?.farmerName}</strong> will be removed from
              this campaign. Any PoDs already submitted for this farmer will not
              be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={removeMutation.isPending}
              onClick={() =>
                removeTarget && removeMutation.mutate(removeTarget.id)
              }
            >
              {removeMutation.isPending ? "Removing…" : "Remove farmer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
