import { useState } from "react";
import { useListDistricts, useListValueChains, useListWarehouses, useCreateValueChain, getListValueChainsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, MapPin, Layers, Warehouse } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddWarehouseModal } from "@/components/modals/AddWarehouseModal";

function AddValueChainModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateValueChain();
  const [name, setName]     = useState("");
  const [desc, setDesc]     = useState("");

  function reset() { setName(""); setDesc(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    try {
      await create.mutateAsync({ data: { name, description: desc || undefined, isActive: true } as any });
      await qc.invalidateQueries({ queryKey: getListValueChainsQueryKey() });
      toast({ title: "Value chain added" });
      reset(); onClose();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Value Chain</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rice, Cocoa, Cassava…" required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={create.isPending || !name}>
              {create.isPending ? "Adding…" : "Add Value Chain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const [whOpen, setWhOpen]   = useState(false);
  const [vcOpen, setVcOpen]   = useState(false);

  const { data: districts,  isLoading: loadingDistricts } = useListDistricts();
  const { data: valueChains, isLoading: loadingVC }        = useListValueChains();
  const { data: warehouses,  isLoading: loadingWh }        = useListWarehouses();

  const districtList:   any[] = (districts   as any[]) ?? [];
  const valueChainList: any[] = (valueChains as any[]) ?? [];
  const warehouseList:  any[] = (warehouses  as any[]) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Settings & Master Data</h1>
        <p className="text-sm text-muted-foreground">Configure locations, value chains, and warehouses used across the system.</p>
      </div>

      <Tabs defaultValue="warehouses">
        <TabsList className="h-8">
          <TabsTrigger value="warehouses"   className="text-xs">Warehouses</TabsTrigger>
          <TabsTrigger value="value-chains" className="text-xs">Value Chains</TabsTrigger>
          <TabsTrigger value="districts"    className="text-xs">Districts</TabsTrigger>
        </TabsList>

        {/* Warehouses */}
        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Warehouses</CardTitle>
                {!loadingWh && <span className="text-xs text-muted-foreground ml-1">{warehouseList.length}</span>}
              </div>
              <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setWhOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[100px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    <TableHead className="hidden lg:table-cell">Address</TableHead>
                    <TableHead className="hidden md:table-cell text-right pr-4">Capacity (MT)</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingWh
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    : warehouseList.length > 0
                    ? warehouseList.map((w: any) => (
                        <TableRow key={w.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{w.code}</TableCell>
                          <TableCell className="text-sm font-medium">{w.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{w.districtName ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{w.address ?? "—"}</TableCell>
                          <TableCell className="hidden md:table-cell text-right pr-4 text-sm tabular-nums text-muted-foreground">{w.capacityMt ?? "—"}</TableCell>
                          <TableCell className="pr-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${w.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                              {w.isActive ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                            No warehouses configured
                          </TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Value Chains */}
        <TabsContent value="value-chains" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Value Chains</CardTitle>
                {!loadingVC && <span className="text-xs text-muted-foreground ml-1">{valueChainList.length}</span>}
              </div>
              <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setVcOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingVC
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-48" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        </TableRow>
                      ))
                    : valueChainList.length > 0
                    ? valueChainList.map((vc: any) => (
                        <TableRow key={vc.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 text-sm font-medium">{vc.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{vc.description ?? "—"}</TableCell>
                          <TableCell className="pr-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${vc.isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                              {vc.isActive ? "Active" : "Inactive"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={3} className="h-24 text-center text-sm text-muted-foreground">No value chains configured</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Districts — read-only reference */}
        <TabsContent value="districts" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Districts</CardTitle>
              {!loadingDistricts && <span className="text-xs text-muted-foreground ml-1">{districtList.length}</span>}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[100px]">Code</TableHead>
                    <TableHead className="pr-4">Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDistricts
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell className="pl-4"><Skeleton className="h-4 w-16" /></TableCell>
                          <TableCell className="pr-4"><Skeleton className="h-4 w-36" /></TableCell>
                        </TableRow>
                      ))
                    : districtList.length > 0
                    ? districtList.map((d: any) => (
                        <TableRow key={d.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                          <TableCell className="pr-4 text-sm">{d.name}</TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={2} className="h-24 text-center text-sm text-muted-foreground">No districts</TableCell>
                        </TableRow>
                      )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddWarehouseModal    open={whOpen} onClose={() => setWhOpen(false)} />
      <AddValueChainModal   open={vcOpen} onClose={() => setVcOpen(false)} />
    </div>
  );
}
