import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDispatch, approveDispatch, dispatchManifest, arriveDispatch, listPod, KEYS } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Truck, MapPin, Package2, ClipboardCheck,
  CheckCircle2, CalendarDays, Warehouse, User, Plus, Smartphone, Car,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { SubmitPodModal } from "@/components/modals/SubmitPodModal";
import { AddManifestItemModal } from "@/components/modals/AddManifestItemModal";
import { StatusBadge } from "@/components/StatusBadge";

const STATUS_STYLES: Record<string, string> = {
  pending:    "bg-slate-100  text-slate-600  border border-slate-200",
  approved:   "bg-amber-100  text-amber-800  border border-amber-200",
  dispatched: "bg-blue-100   text-blue-800   border border-blue-200",
  intransit:  "bg-blue-100   text-blue-800   border border-blue-200",
  arrived:    "bg-teal-100   text-teal-800   border border-teal-200",
  completed:  "bg-emerald-100 text-emerald-800 border border-emerald-200",
  cancelled:  "bg-red-100    text-red-800    border border-red-200",
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

export default function DispatchDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [actionLoading, setActionLoading] = useState(false);
  const [podOpen, setPodOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);

  const { data: dispatch, isLoading } = useQuery({
    queryKey: KEYS.dispatch(id),
    queryFn: () => getDispatch(id),
    enabled: !!id,
  });
  const { data: podData } = useQuery({
    queryKey: KEYS.pod(undefined, id),
    queryFn: () => listPod(1, 100, id),
    enabled: !!id,
  });

  const approveMutation  = useMutation({ mutationFn: () => approveDispatch(id) });
  const dispatchMutation = useMutation({ mutationFn: () => dispatchManifest(id) });
  const arriveMutation   = useMutation({ mutationFn: () => arriveDispatch(id) });

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: KEYS.dispatch(id) }),
      qc.invalidateQueries({ queryKey: KEYS.dispatches() }),
    ]);
  }

  async function handleApprove() {
    setActionLoading(true);
    try {
      await approveMutation.mutateAsync();
      await invalidate();
      toast({ title: "Manifest approved" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(false); }
  }

  async function handleDispatch() {
    setActionLoading(true);
    try {
      await dispatchMutation.mutateAsync();
      await invalidate();
      toast({ title: "Vehicle dispatched" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(false); }
  }

  async function handleArrive() {
    setActionLoading(true);
    try {
      await arriveMutation.mutateAsync();
      await invalidate();
      toast({ title: "Arrival confirmed" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
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

  if (!dispatch) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <span>Manifest not found.</span>
        <Link href="/dispatch"><Button variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back</Button></Link>
      </div>
    );
  }

  const d = dispatch as any;
  const status = (d.status ?? "").toLowerCase().replace(/\s+/g, "");
  const items: any[] = d.items ?? [];
  const pods: any[] = (podData as any)?.data ?? [];
  const canAddItems = status === "draft" || status === "pending" || status === "approved";
  const canRecordDelivery = status === "arrived" || status === "completed";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dispatch">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{d.manifestCode}</h1>
          <p className="text-xs text-muted-foreground">{d.campaignName ?? "No campaign"}</p>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
            {d.status}
          </span>
          {(status === "draft" || status === "pending") && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actionLoading} onClick={handleApprove}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          )}
          {status === "approved" && (
            <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white" disabled={actionLoading} onClick={handleDispatch}>
              <Truck className="h-3.5 w-3.5 mr-1" /> Dispatch
            </Button>
          )}
          {(status === "dispatched" || status === "intransit") && (
            <Button size="sm" className="h-7 text-xs bg-teal-600 hover:bg-teal-700 text-white" disabled={actionLoading} onClick={handleArrive}>
              <MapPin className="h-3.5 w-3.5 mr-1" /> Mark Arrived
            </Button>
          )}
          {canRecordDelivery && (
            <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setPodOpen(true)}>
              <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Record Delivery
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="manifest">
        <TabsList className="h-8">
          <TabsTrigger value="manifest" className="text-xs">Manifest</TabsTrigger>
          <TabsTrigger value="items" className="text-xs">
            Line Items
            {items.length > 0 && <span className="ml-1 text-xs bg-muted rounded px-1">{items.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="pod" className="text-xs">
            PoD Records
            {pods.length > 0 && <span className="ml-1 text-xs bg-muted rounded px-1">{pods.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manifest" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">Dispatch Information</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <Field label="Campaign"   value={d.campaignName}   icon={Package2} />
                  <Field label="Warehouse"  value={d.warehouseName}  icon={Warehouse} />
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {d.isHired ? <Truck className="h-3 w-3" /> : <Car className="h-3 w-3" />}
                      Vehicle
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{d.plateNumber ?? "—"}</p>
                      {d.isHired && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Hired Truck</span>
                      )}
                    </div>
                  </div>
                  <Field label="Driver"     value={d.driverName}     icon={User} />
                  <Field label="Scheduled"  value={d.scheduledDate ? new Date(d.scheduledDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : undefined} icon={CalendarDays} />
                  <Field label="Departed"   value={d.departedAt ? new Date(d.departedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : undefined} />
                  <Field label="Arrived"    value={d.arrivedAt ? new Date(d.arrivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : undefined} icon={MapPin} />
                  {d.notes && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-xs text-muted-foreground">Notes</p>
                      <p className="text-sm">{d.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3 pt-4">
                  <CardTitle className="text-sm font-semibold">Delivery Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Delivery progress bar */}
                  {(d.totalPackages ?? 0) > 0 && (() => {
                    const delivered = d.deliveredPackages ?? 0;
                    const total     = d.totalPackages ?? 0;
                    const pct       = Math.min(100, Math.round((delivered / total) * 100));
                    return (
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                          <span>Delivery progress</span>
                          <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct === 100 ? "bg-emerald-500" : "bg-blue-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {delivered.toLocaleString()} of {total.toLocaleString()} packages delivered
                        </p>
                      </div>
                    );
                  })()}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Line Items</span>
                      <span className="text-sm font-semibold">{items.length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Total Loaded</span>
                      <span className="text-sm font-semibold">{(d.totalPackages ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Delivered</span>
                      <span className="text-sm font-semibold text-emerald-700">{(d.deliveredPackages ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">PoD Records</span>
                      <span className="text-sm font-semibold">{pods.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Field App QR code for mobile scanning */}
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <Smartphone className="h-4 w-4" /> Field App QR
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3 pb-4">
                  <div className="p-2 bg-white rounded-lg border">
                    <QRCodeSVG
                      value={`dispatch:${d.id}:${d.manifestCode}`}
                      size={140}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="text-center space-y-0.5">
                    <p className="text-xs font-mono font-medium">{d.manifestCode}</p>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      Scan with field app to record delivery
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="items" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Items Loaded</CardTitle>
              {canAddItems && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Input Item</TableHead>
                    <TableHead className="text-right">Loaded</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Delivered</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Returned</TableHead>
                    <TableHead className="text-right pr-4 hidden md:table-cell">Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-28 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Package2 className="h-7 w-7 opacity-30" />
                          <span className="text-sm">No items added yet</span>
                          {canAddItems && (
                            <Button size="sm" variant="outline" onClick={() => setAddItemOpen(true)}>
                              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add first item
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : items.map((item: any) => (
                    <TableRow key={item.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 text-sm font-medium">{item.itemName ?? item.inputItemName ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">{item.quantityLoaded?.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums hidden md:table-cell text-emerald-700">{item.quantityDelivered ?? 0}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums hidden lg:table-cell text-muted-foreground">{item.quantityReturned ?? 0}</TableCell>
                      <TableCell className="text-right pr-4 text-sm text-muted-foreground hidden md:table-cell">{item.unit ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pod" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Proof of Delivery</CardTitle>
              {canRecordDelivery && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setPodOpen(true)}>
                  <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Record Delivery
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[130px]">PoD Code</TableHead>
                    <TableHead>Farmer</TableHead>
                    <TableHead className="hidden md:table-cell">Item</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-4 text-right hidden lg:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pods.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-sm">
                        No deliveries recorded yet
                      </TableCell>
                    </TableRow>
                  ) : pods.map((p: any) => (
                    <TableRow key={p.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{p.podCode}</TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{p.farmerName}</p>
                        <p className="text-xs text-muted-foreground">{p.farmerCode}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{p.inputItemName ?? "—"}</TableCell>
                      <TableCell className="text-right text-sm hidden sm:table-cell">{p.quantityDelivered}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="pr-4 text-right text-xs text-muted-foreground hidden lg:table-cell">
                        {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SubmitPodModal open={podOpen} onClose={() => setPodOpen(false)} prefilledDispatchId={id} />
      <AddManifestItemModal open={addItemOpen} onClose={() => setAddItemOpen(false)} dispatchId={id} />
    </div>
  );
}
