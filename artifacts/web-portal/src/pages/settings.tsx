import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listDistricts, createDistrict, updateDistrict, deleteDistrict,
  listValueChains, createValueChain, updateValueChain, toggleValueChain,
  listWarehouses, createWarehouse, updateWarehouse, toggleWarehouse,
  listInputItems, createInputItem, updateInputItem, toggleInputItem, deleteInputItem,
  listDistributionSites, createDistributionSite, updateDistributionSite, toggleDistributionSite,
  listItemTemplates, createItemTemplate, updateItemTemplate, toggleItemTemplate,
  ALLOCATION_BASIS_LABELS, type AllocationBasis, type ItemTemplateLineInput,
  KEYS,
} from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MapPin, Layers, Warehouse, Package, Pencil, Trash2, Power, Target, AlertTriangle, Boxes, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ActionBtn({ icon: Icon, label, onClick, variant = "ghost", className = "" }: {
  icon: React.ElementType; label: string; onClick: () => void; variant?: "ghost" | "destructive"; className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 w-7 p-0 ${variant === "destructive" ? "hover:text-red-600 hover:bg-red-50" : "hover:bg-muted"} ${className}`}
      onClick={onClick}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

function ConfirmDelete({ open, name, onConfirm, onCancel, busy }: {
  open: boolean; name: string; onConfirm: () => void; onCancel: () => void; busy: boolean;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{name}"?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={busy}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {busy ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

function WarehouseDialog({ open, item, districts, onClose }: {
  open: boolean; item: any | null; districts: any[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [code, setCode]       = useState("");
  const [name, setName]       = useState("");
  const [districtId, setDist] = useState("");
  const [address, setAddr]    = useState("");

  // The dialog stays mounted between edits, so state must follow the item
  // rather than being seeded once on first mount.
  useEffect(() => {
    if (!open) return;
    setCode(item?.code ?? "");
    setName(item?.name ?? "");
    setDist(item?.districtId ? String(item.districtId) : "");
    setAddr(item?.address ?? "");
  }, [item, open]);

  const districtValue = districtId && districtId !== "none" ? Number(districtId) : null;

  const save = useMutation({
    mutationFn: () => isEdit
      ? updateWarehouse(item.id, { name, code, districtId: districtValue, address: address || null })
      : createWarehouse({ name, code: code.toUpperCase(), districtId: districtValue ?? undefined, address: address || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.warehouses() });
      toast({ title: isEdit ? "Warehouse updated" : "Warehouse added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Warehouse" : "Add Warehouse"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Code *</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="WH-BO" required />
          </div>
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Bo District Warehouse" required />
          </div>
          <div className="space-y-1.5">
            <Label>District</Label>
            <Select value={districtId} onValueChange={setDist}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {districts.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={e => setAddr(e.target.value)} placeholder="Dambara Road, Bo" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={save.isPending || !code || !name}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Warehouse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delivery Sites ───────────────────────────────────────────────────────────
// A campaign cannot be created without one, and it cannot be approved unless the
// site is active, sits in the campaign's district, and carries GPS coordinates
// (enforced by the approve_campaign guard). The form therefore requires all four.


// ─── Input Packages ──────────────────────────────────────────────────────────
// A package is the set of rules a campaign copies in. Each line carries a rate
// and the basis it is read against, so one template covers groups of any size.
function ItemTemplateDialog({ open, item, inputItems, valueChains, onClose }: {
  open: boolean; item: any | null; inputItems: any[]; valueChains: any[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [valueChainId, setValueChainId] = useState("none");
  const [lines, setLines] = useState<ItemTemplateLineInput[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setDescription(item?.description ?? "");
    setValueChainId(item?.valueChainId ? String(item.valueChainId) : "none");
    setLines(
      (item?.lines ?? []).map((line: any) => ({
        inputItemId: Number(line.inputItemId),
        quantity: Number(line.quantity),
        basis: (line.basis ?? "per_beneficiary") as AllocationBasis,
      })),
    );
  }, [item, open]);

  const used = new Set(lines.map(line => line.inputItemId));
  const available = inputItems.filter((i: any) => Number(i.isActive) === 1 && !used.has(i.id));
  const complete = lines.length > 0 && lines.every(line => line.inputItemId > 0 && line.quantity > 0);
  const canSave = !!name.trim() && complete;

  function addLine() {
    const next = available[0];
    if (!next) return;
    setLines(prev => [...prev, { inputItemId: next.id, quantity: 1, basis: "per_beneficiary" }]);
  }
  function updateLine(index: number, patch: Partial<ItemTemplateLineInput>) {
    setLines(prev => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        valueChainId: valueChainId === "none" ? null : Number(valueChainId),
        lines,
      };
      return isEdit ? updateItemTemplate(item.id, payload) : createItemTemplate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.itemTemplates() });
      toast({ title: isEdit ? "Package updated" : "Package created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Input Package" : "New Input Package"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input className="h-8 text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="Rice starter package" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Value chain / intervention</Label>
              <Select value={valueChainId} onValueChange={setValueChainId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any</SelectItem>
                  {valueChains.filter((v: any) => Number(v.isActive) === 1).map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input className="h-8 text-sm" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional note for coordinators" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Items</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={available.length === 0} onClick={addLine}>
                <Plus className="h-3 w-3 mr-1" /> Add item
              </Button>
            </div>
            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-3 text-center border rounded-md">
                No items yet. A package needs at least one.
              </p>
            ) : lines.map((line, index) => {
              const choices = inputItems.filter((i: any) => i.id === line.inputItemId || (Number(i.isActive) === 1 && !used.has(i.id)));
              return (
                <div key={index} className="flex gap-2 items-center">
                  <Select value={String(line.inputItemId)} onValueChange={v => updateLine(index, { inputItemId: Number(v) })}>
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {choices.map((i: any) => (
                        <SelectItem key={i.id} value={String(i.id)}>{i.name}{i.unit ? ` (${i.unit})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="h-8 w-20 text-sm" type="number" min="0.01" step="any" aria-label="Rate"
                    value={String(line.quantity)}
                    onChange={e => updateLine(index, { quantity: Number(e.target.value) })}
                  />
                  <Select value={line.basis} onValueChange={v => updateLine(index, { basis: v as AllocationBasis })}>
                    <SelectTrigger className="h-8 text-xs w-40 shrink-0" aria-label="Basis"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ALLOCATION_BASIS_LABELS) as AllocationBasis[]).map(basis => (
                        <SelectItem key={basis} value={basis}>{ALLOCATION_BASIS_LABELS[basis]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0 hover:text-red-600 hover:bg-red-50"
                    title="Remove line"
                    onClick={() => setLines(prev => prev.filter((_, i) => i !== index))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm" className="bg-green-700 hover:bg-green-800 text-white"
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DistributionSiteDialog({ open, item, districts, onClose }: {
  open: boolean; item: any | null; districts: any[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [name, setName]         = useState("");
  const [districtId, setDist]   = useState("");
  const [latitude, setLat]      = useState("");
  const [longitude, setLng]     = useState("");
  const [radius, setRadius]     = useState("500");

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setDist(item?.districtId ? String(item.districtId) : "");
    setLat(item?.latitude != null ? String(item.latitude) : "");
    setLng(item?.longitude != null ? String(item.longitude) : "");
    setRadius(item?.geofenceRadius != null ? String(item.geofenceRadius) : "500");
  }, [item, open]);

  const lat = Number(latitude);
  const lng = Number(longitude);
  const latValid = latitude.trim() !== "" && Number.isFinite(lat) && lat >= -90  && lat <= 90;
  const lngValid = longitude.trim() !== "" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
  const radiusNum = Number(radius);
  const radiusValid = radius.trim() !== "" && Number.isFinite(radiusNum) && radiusNum > 0;
  const canSave = !!name.trim() && !!districtId && latValid && lngValid && radiusValid;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        districtId: Number(districtId),
        latitude: lat,
        longitude: lng,
        geofenceRadius: radiusNum,
      };
      return isEdit ? updateDistributionSite(item.id, payload) : createDistributionSite(payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.distributionSites() });
      toast({ title: isEdit ? "Delivery site updated" : "Delivery site added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Delivery Site" : "Add Delivery Site"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Falaba Distribution Point" required />
          </div>
          <div className="space-y-1.5">
            <Label>District *</Label>
            <Select value={districtId} onValueChange={setDist}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>
                {districts.map((d: any) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              A campaign can only use a site in its own district.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Latitude *</Label>
              <Input
                value={latitude}
                onChange={e => setLat(e.target.value)}
                placeholder="9.51670"
                inputMode="decimal"
                className={latitude && !latValid ? "border-red-400" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Longitude *</Label>
              <Input
                value={longitude}
                onChange={e => setLng(e.target.value)}
                placeholder="-11.36670"
                inputMode="decimal"
                className={longitude && !lngValid ? "border-red-400" : ""}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Geofence radius (metres) *</Label>
            <Input
              type="number" min="1" step="any"
              value={radius}
              onChange={e => setRadius(e.target.value)}
              className={radius && !radiusValid ? "border-red-400" : ""}
            />
            <p className="text-[10px] text-muted-foreground">
              How close a vehicle must get before it counts as arrived. 500 m suits most sites.
            </p>
          </div>
          {!canSave && (name || districtId || latitude || longitude) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-800">
                Name, district, and valid coordinates are all required — a campaign cannot be
                approved against a site that is missing any of them.
              </p>
            </div>
          )}
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={save.isPending || !canSave}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Delivery Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Value Chains ─────────────────────────────────────────────────────────────

function ValueChainDialog({ open, item, onClose }: { open: boolean; item: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setDesc(item?.description ?? "");
  }, [item, open]);

  const save = useMutation({
    mutationFn: () => isEdit
      ? updateValueChain(item.id, { name, description: desc || undefined })
      : createValueChain({ name, description: desc || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.valueChains() });
      toast({ title: isEdit ? "Value chain updated" : "Value chain added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Value Chain" : "Add Value Chain"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rice, Cocoa, Cassava…" required />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={save.isPending || !name}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Value Chain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Districts ────────────────────────────────────────────────────────────────

function DistrictDialog({ open, item, onClose }: { open: boolean; item: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setCode(item?.code ?? "");
  }, [item, open]);

  const save = useMutation({
    mutationFn: () => isEdit
      ? updateDistrict(item.id, { name, code: code.toUpperCase() })
      : createDistrict({ name, code: code.toUpperCase() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.districts() });
      toast({ title: isEdit ? "District updated" : "District added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit District" : "Add District"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Code * <span className="text-xs text-muted-foreground">(short, e.g. BO)</span></Label>
            <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="BO" required maxLength={10} />
          </div>
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Bo" required />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={save.isPending || !name || !code}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add District"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Input Items ──────────────────────────────────────────────────────────────

const INPUT_CATEGORIES = ["Seed", "Fertiliser", "Chemical", "Tool", "Equipment", "Other"];

function InputItemDialog({ open, item, valueChains, onClose }: {
  open: boolean; item: any | null; valueChains: any[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const isEdit = !!item;

  const [name, setName]           = useState("");
  const [itemCode, setItemCode]   = useState("");
  const [unit, setUnit]           = useState("");
  const [category, setCategory]   = useState("");
  const [vcId, setVcId]           = useState("");
  const [barcode, setBarcode]     = useState("");
  const [description, setDesc]    = useState("");

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setItemCode(item?.itemCode ?? "");
    setUnit(item?.unit ?? "");
    setCategory(item?.category ?? "");
    setVcId(item?.valueChainId ? String(item.valueChainId) : "");
    setBarcode(item?.barcode ?? "");
    setDesc(item?.description ?? "");
  }, [item, open]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        itemCode,
        unit,
        // "none" is the placeholder option's value, not a real category.
        category: category && category !== "none" ? category : null,
        valueChainId: vcId && vcId !== "none" ? Number(vcId) : null,
        barcode: barcode || null,
        description: description || null,
      };
      return isEdit ? updateInputItem(item.id, payload) : createInputItem(payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.inputItems() });
      toast({ title: isEdit ? "Item updated" : "Item added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Input Item" : "Add Input Item"}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Hybrid Maize Seed" required />
            </div>
            <div className="space-y-1.5">
              <Label>Item Code *</Label>
              <Input value={itemCode} onChange={e => setItemCode(e.target.value.toUpperCase())} placeholder="ITEM-001" required />
            </div>
            <div className="space-y-1.5">
              <Label>Unit *</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, litre, piece…" required />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {INPUT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Value Chain</Label>
              <Select value={vcId} onValueChange={setVcId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {valueChains.map((vc: any) => <SelectItem key={vc.id} value={String(vc.id)}>{vc.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Barcode <span className="text-xs text-muted-foreground">(for field scan)</span></Label>
              <Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Optional barcode value" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Description</Label>
              <Input value={description} onChange={e => setDesc(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={save.isPending || !name || !itemCode || !unit}>
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const can = usePermissions();
  const qc  = useQueryClient();
  const { toast } = useToast();

  // Dialog states
  const [whDialog,   setWhDialog]   = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [vcDialog,   setVcDialog]   = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [distDialog, setDistDialog] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [siteDialog, setSiteDialog] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });
  const [templateDialog, setTemplateDialog] = useState<{ open: boolean; item: any | null }>({ open: false, item: null });

  // Delete confirm states
  const [delDist, setDelDist] = useState<any | null>(null);
  const [delItem, setDelItem] = useState<any | null>(null);

  const { data: districts,   isLoading: loadingDistricts } = useQuery({ queryKey: KEYS.districts(),   queryFn: listDistricts });
  const { data: valueChains, isLoading: loadingVC }        = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });
  const { data: warehouses,  isLoading: loadingWh }        = useQuery({ queryKey: KEYS.warehouses(),  queryFn: listWarehouses });
  const { data: inputItems,  isLoading: loadingItems }     = useQuery({ queryKey: KEYS.inputItems(),  queryFn: listInputItems });
  const { data: sites,       isLoading: loadingSites }     = useQuery({ queryKey: KEYS.distributionSites(), queryFn: listDistributionSites });
  const { data: templates,   isLoading: loadingTemplates } = useQuery({ queryKey: KEYS.itemTemplates(), queryFn: listItemTemplates });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];
  const warehouseList:  any[] = Array.isArray(warehouses)  ? warehouses  : [];
  const inputItemList:  any[] = Array.isArray(inputItems)  ? inputItems  : [];
  const siteList:       any[] = Array.isArray(sites)       ? sites       : [];
  const templateList:   any[] = Array.isArray(templates)   ? templates   : [];

  // Toggle mutations
  const toggleWh = useMutation({
    mutationFn: (id: number) => toggleWarehouse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.warehouses() }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const toggleVc = useMutation({
    mutationFn: (id: number) => toggleValueChain(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.valueChains() }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const toggleSite = useMutation({
    mutationFn: (id: number) => toggleDistributionSite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.distributionSites() }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const toggleTemplate = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => toggleItemTemplate(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.itemTemplates() }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const toggleItem = useMutation({
    mutationFn: (id: number) => toggleInputItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.inputItems() }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Delete mutations
  const delDistMut = useMutation({
    mutationFn: (id: number) => deleteDistrict(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.districts() });
      toast({ title: "District deleted" });
      setDelDist(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });
  const delItemMut = useMutation({
    mutationFn: (id: number) => deleteInputItem(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEYS.inputItems() });
      toast({ title: "Item removed" });
      setDelItem(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const skeletonRow = (cols: number) => Array.from({ length: 4 }).map((_, i) => (
    <TableRow key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <TableCell key={j} className={j === 0 ? "pl-4" : j === cols - 1 ? "pr-4" : ""}>
          <Skeleton className="h-4 w-full max-w-[120px]" />
        </TableCell>
      ))}
    </TableRow>
  ));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings & Master Data"
        subtitle="Configure locations, value chains, and warehouses used across the system."
      />

      <Tabs defaultValue="warehouses">
        <TabsList className="h-8">
          <TabsTrigger value="warehouses"   className="text-xs">Warehouses</TabsTrigger>
          <TabsTrigger value="value-chains" className="text-xs">Value Chains</TabsTrigger>
          <TabsTrigger value="districts"    className="text-xs">Districts</TabsTrigger>
          <TabsTrigger value="input-items"  className="text-xs">Input Items</TabsTrigger>
          <TabsTrigger value="delivery-sites" className="text-xs">Delivery Sites</TabsTrigger>
          <TabsTrigger value="packages"     className="text-xs">Input Packages</TabsTrigger>
        </TabsList>

        {/* ── Warehouses ── */}
        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Warehouses</CardTitle>
                {!loadingWh && <span className="text-xs text-muted-foreground ml-1">{warehouseList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setWhDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[100px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    <TableHead className="hidden lg:table-cell">Address</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingWh ? skeletonRow(can.manageSettings ? 6 : 5)
                  : warehouseList.length > 0
                  ? warehouseList.map((w: any) => (
                      <TableRow key={w.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{w.code}</TableCell>
                        <TableCell className="text-sm font-medium">{w.name}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{w.districtName ?? "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{w.address ?? "—"}</TableCell>
                        <TableCell><ActiveBadge active={!!w.isActive} /></TableCell>
                        {can.manageSettings && (
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-0.5 justify-end">
                              <ActionBtn icon={Pencil} label="Edit" onClick={() => setWhDialog({ open: true, item: w })} />
                              <ActionBtn
                                icon={Power}
                                label={w.isActive ? "Deactivate" : "Activate"}
                                onClick={() => toggleWh.mutate(w.id)}
                                className={w.isActive ? "hover:text-orange-600 hover:bg-orange-50" : "hover:text-green-600 hover:bg-green-50"}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 6 : 5} className="h-24 text-center text-sm text-muted-foreground">No warehouses configured</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Value Chains ── */}
        <TabsContent value="value-chains" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Value Chains</CardTitle>
                {!loadingVC && <span className="text-xs text-muted-foreground ml-1">{valueChainList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setVcDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingVC ? skeletonRow(can.manageSettings ? 4 : 3)
                  : valueChainList.length > 0
                  ? valueChainList.map((vc: any) => (
                      <TableRow key={vc.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 text-sm font-medium">{vc.name}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{vc.description ?? "—"}</TableCell>
                        <TableCell><ActiveBadge active={!!vc.isActive} /></TableCell>
                        {can.manageSettings && (
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-0.5 justify-end">
                              <ActionBtn icon={Pencil} label="Edit" onClick={() => setVcDialog({ open: true, item: vc })} />
                              <ActionBtn
                                icon={Power}
                                label={vc.isActive ? "Deactivate" : "Activate"}
                                onClick={() => toggleVc.mutate(vc.id)}
                                className={vc.isActive ? "hover:text-orange-600 hover:bg-orange-50" : "hover:text-green-600 hover:bg-green-50"}
                              />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 4 : 3} className="h-24 text-center text-sm text-muted-foreground">No value chains configured</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Districts ── */}
        <TabsContent value="districts" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Districts</CardTitle>
                {!loadingDistricts && <span className="text-xs text-muted-foreground ml-1">{districtList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setDistDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[100px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingDistricts ? skeletonRow(can.manageSettings ? 3 : 2)
                  : districtList.length > 0
                  ? districtList.map((d: any) => (
                      <TableRow key={d.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                        <TableCell className="text-sm">{d.name}</TableCell>
                        {can.manageSettings && (
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-0.5 justify-end">
                              <ActionBtn icon={Pencil} label="Edit" onClick={() => setDistDialog({ open: true, item: d })} />
                              <ActionBtn icon={Trash2} label="Delete" variant="destructive" onClick={() => setDelDist(d)} />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 3 : 2} className="h-24 text-center text-sm text-muted-foreground">No districts</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Input Items ── */}
        <TabsContent value="input-items" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Input Items</CardTitle>
                {!loadingItems && <span className="text-xs text-muted-foreground ml-1">{inputItemList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setItemDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden md:table-cell">Value Chain</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[100px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingItems ? skeletonRow(can.manageSettings ? 6 : 5)
                  : inputItemList.length > 0
                  ? inputItemList.map((item: any) => (
                      <TableRow key={item.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 text-sm font-medium">{item.name}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground capitalize">{item.category ?? "—"}</TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{item.valueChainName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.unit ?? "—"}</TableCell>
                        <TableCell><ActiveBadge active={!!item.isActive} /></TableCell>
                        {can.manageSettings && (
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-0.5 justify-end">
                              <ActionBtn icon={Pencil} label="Edit" onClick={() => setItemDialog({ open: true, item })} />
                              <ActionBtn
                                icon={Power}
                                label={item.isActive ? "Deactivate" : "Activate"}
                                onClick={() => toggleItem.mutate(item.id)}
                                className={item.isActive ? "hover:text-orange-600 hover:bg-orange-50" : "hover:text-green-600 hover:bg-green-50"}
                              />
                              <ActionBtn icon={Trash2} label="Delete" variant="destructive" onClick={() => setDelItem(item)} />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 6 : 5} className="h-24 text-center text-sm text-muted-foreground">No input items configured</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Delivery Sites ── */}
        <TabsContent value="packages" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Input Packages</CardTitle>
                {!loadingTemplates && <span className="text-xs text-muted-foreground ml-1">{templateList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setTemplateDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <p className="px-4 pb-3 text-[11px] text-muted-foreground">
                A saved package is applied to a campaign in one action. Each line
                is a rate plus the basis it is read against, so the same package
                gives a twenty-member group twenty hoes and a single tractor.
              </p>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Value Chain</TableHead>
                    <TableHead className="hidden lg:table-cell">Items</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingTemplates ? skeletonRow(can.manageSettings ? 5 : 4)
                  : templateList.length > 0
                  ? templateList.map((template: any) => (
                      <TableRow key={template.id} className="hover:bg-muted/40">
                        <TableCell className="pl-4 text-sm font-medium">
                          {template.name}
                          {template.description && (
                            <span className="block text-[11px] text-muted-foreground font-normal">{template.description}</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {template.valueChainName ?? "Any"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {(template.lines ?? []).length === 0 ? "—" : (template.lines ?? []).map((line: any) => (
                            <span key={line.id} className="block leading-tight">
                              {line.inputItemName ?? "Item"} &times;{line.quantity}{" "}
                              <span className="opacity-70">
                                {ALLOCATION_BASIS_LABELS[(line.basis ?? "per_beneficiary") as AllocationBasis]?.toLowerCase()}
                              </span>
                            </span>
                          ))}
                        </TableCell>
                        <TableCell><ActiveBadge active={Number(template.isActive) === 1} /></TableCell>
                        {can.manageSettings && (
                          <TableCell className="pr-4 text-right whitespace-nowrap">
                            <ActionBtn icon={Pencil} label="Edit" onClick={() => setTemplateDialog({ open: true, item: template })} />
                            <ActionBtn
                              icon={Power}
                              label={Number(template.isActive) === 1 ? "Deactivate" : "Activate"}
                              onClick={() => toggleTemplate.mutate({ id: template.id, isActive: Number(template.isActive) !== 1 })}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 5 : 4} className="h-24 text-center text-sm text-muted-foreground">No input packages configured</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery-sites" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Delivery Sites</CardTitle>
                {!loadingSites && <span className="text-xs text-muted-foreground ml-1">{siteList.length}</span>}
              </div>
              {can.manageSettings && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setSiteDialog({ open: true, item: null })}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!loadingSites && siteList.length === 0 && (
                <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-800">
                    No delivery sites exist yet, so no campaign can be created — the Create Campaign
                    form requires one. Add at least one site per district you distribute in.
                  </p>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    <TableHead className="hidden lg:table-cell">Coordinates</TableHead>
                    <TableHead className="hidden lg:table-cell">Geofence</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 w-[80px]"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingSites ? skeletonRow(can.manageSettings ? 6 : 5)
                  : siteList.length > 0
                  ? siteList.map((site: any) => {
                      const hasGps = site.latitude != null && site.longitude != null;
                      return (
                        <TableRow key={site.id} className="hover:bg-muted/40">
                          <TableCell className="pl-4 text-sm font-medium">{site.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{site.districtName ?? "—"}</TableCell>
                          <TableCell className="hidden lg:table-cell text-xs">
                            {hasGps ? (
                              <span className="font-mono text-muted-foreground">
                                {Number(site.latitude).toFixed(5)}, {Number(site.longitude).toFixed(5)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <AlertTriangle className="h-3 w-3" /> No GPS — blocks approval
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {site.geofenceRadius != null ? `${site.geofenceRadius} m` : "—"}
                          </TableCell>
                          <TableCell><ActiveBadge active={!!site.isActive} /></TableCell>
                          {can.manageSettings && (
                            <TableCell className="pr-4">
                              <div className="flex items-center gap-0.5 justify-end">
                                <ActionBtn icon={Pencil} label="Edit" onClick={() => setSiteDialog({ open: true, item: site })} />
                                <ActionBtn
                                  icon={Power}
                                  label={site.isActive ? "Deactivate" : "Activate"}
                                  onClick={() => toggleSite.mutate(site.id)}
                                  className={site.isActive ? "hover:text-orange-600 hover:bg-orange-50" : "hover:text-green-600 hover:bg-green-50"}
                                />
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                  : (
                      <TableRow>
                        <TableCell colSpan={can.manageSettings ? 6 : 5} className="h-24 text-center text-sm text-muted-foreground">No delivery sites configured</TableCell>
                      </TableRow>
                    )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ItemTemplateDialog
        open={templateDialog.open}
        item={templateDialog.item}
        inputItems={inputItemList}
        valueChains={valueChainList}
        onClose={() => setTemplateDialog({ open: false, item: null })}
      />

      <DistributionSiteDialog
        open={siteDialog.open}
        item={siteDialog.item}
        districts={districtList}
        onClose={() => setSiteDialog({ open: false, item: null })}
      />

      {/* ── Dialogs ── */}
      <WarehouseDialog
        open={whDialog.open}
        item={whDialog.item}
        districts={districtList}
        onClose={() => setWhDialog({ open: false, item: null })}
      />
      <ValueChainDialog
        open={vcDialog.open}
        item={vcDialog.item}
        onClose={() => setVcDialog({ open: false, item: null })}
      />
      <DistrictDialog
        open={distDialog.open}
        item={distDialog.item}
        onClose={() => setDistDialog({ open: false, item: null })}
      />
      <InputItemDialog
        open={itemDialog.open}
        item={itemDialog.item}
        valueChains={valueChainList}
        onClose={() => setItemDialog({ open: false, item: null })}
      />

      {/* ── Delete confirms ── */}
      <ConfirmDelete
        open={!!delDist}
        name={delDist?.name ?? ""}
        onConfirm={() => delDistMut.mutate(delDist!.id)}
        onCancel={() => setDelDist(null)}
        busy={delDistMut.isPending}
      />
      <ConfirmDelete
        open={!!delItem}
        name={delItem?.name ?? ""}
        onConfirm={() => delItemMut.mutate(delItem!.id)}
        onCancel={() => setDelItem(null)}
        busy={delItemMut.isPending}
      />
    </div>
  );
}
