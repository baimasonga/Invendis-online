import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listDistricts, listChiefdoms, listValueChains, listWarehouses,
  listDistributionSites, listInputItems, listSystemSettings,
  createDistrict, createChiefdom, updateChiefdom, deleteChiefdom,
  createValueChain, updateValueChain, toggleValueChain,
  createWarehouse, updateWarehouse, toggleWarehouse, importWarehouses,
  createDistributionSite, updateDistributionSite, toggleDistributionSite, importDistributionSites,
  createInputItem, updateInputItem, toggleInputItem,
  saveSystemSettings,
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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, MapPin, Layers, Warehouse, Download, Upload, Pencil, PowerOff, Power, Leaf, Navigation, Settings2, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";

// ── CSV helpers ───────────────────────────────────────────────────────────────
function exportCsv(filename: string, headers: string[], rows: Record<string, any>[]) {
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

// ── Shared status badge ───────────────────────────────────────────────────────
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── Import button helper ──────────────────────────────────────────────────────
function ImportButton({ onImport, template }: { onImport: (rows: any[]) => Promise<void>; template: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { toast({ title: "Empty or invalid CSV", variant: "destructive" }); return; }
    setLoading(true);
    try {
      await onImport(rows);
    } finally {
      setLoading(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept=".csv" className="hidden" onChange={handle} />
      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={loading}
        onClick={() => ref.current?.click()} title={`CSV headers: ${template}`}>
        <Upload className="h-3.5 w-3.5 mr-1" /> {loading ? "Importing…" : "Import CSV"}
      </Button>
    </>
  );
}

// ── Warehouses ────────────────────────────────────────────────────────────────
function WarehouseModal({ open, onClose, item, districts }: { open: boolean; onClose: () => void; item?: any; districts: any[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [districtId, setDist] = useState(item?.districtId ? String(item.districtId) : "");
  const [address, setAddr] = useState(item?.address ?? "");
  const isEdit = !!item;
  const fn = isEdit ? () => updateWarehouse(item.id, { name, code, districtId: districtId ? Number(districtId) : null, address: address || null })
                    : () => createWarehouse({ name, code: code.toUpperCase(), districtId: districtId ? Number(districtId) : null, address: address || null });
  const mut = useMutation({ mutationFn: fn });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.warehouses() });
      toast({ title: isEdit ? "Warehouse updated" : "Warehouse added" });
      onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Warehouse" : "Add Warehouse"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="WH-BO" required />
            </div>
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Bo Warehouse" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>District</Label>
            <Select value={districtId} onValueChange={setDist}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>{districts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={e => setAddr(e.target.value)} placeholder="Dambara Road, Bo" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !code || !name}>
              {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Warehouse"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Value Chain Modal ─────────────────────────────────────────────────────────
function ValueChainModal({ open, onClose, item }: { open: boolean; onClose: () => void; item?: any }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [desc, setDesc] = useState(item?.description ?? "");
  const isEdit = !!item;
  const fn = isEdit ? () => updateValueChain(item.id, { name, description: desc || undefined })
                    : () => createValueChain({ name, description: desc || undefined });
  const mut = useMutation({ mutationFn: fn });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.valueChains() });
      toast({ title: isEdit ? "Value chain updated" : "Value chain added" });
      onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Value Chain" : "Add Value Chain"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Rice, Cocoa…" required /></div>
          <div className="space-y-1.5"><Label>Description</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" /></div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !name}>
              {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Value Chain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── District Modal ────────────────────────────────────────────────────────────
function DistrictModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [name, setName] = useState(""); const [code, setCode] = useState("");
  const mut = useMutation({ mutationFn: () => createDistrict({ name, code: code.toUpperCase() }) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.districts() });
      toast({ title: "District added" }); setName(""); setCode(""); onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add District</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Code *</Label><Input value={code} onChange={e => setCode(e.target.value)} placeholder="BO" required /></div>
            <div className="space-y-1.5"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Bo District" required /></div>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !name || !code}>
              {mut.isPending ? "Adding…" : "Add District"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Chiefdom Modal ────────────────────────────────────────────────────────────
function ChiefdomModal({ open, onClose, item, districts }: { open: boolean; onClose: () => void; item?: any; districts: any[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [districtId, setDist] = useState(item?.districtId ? String(item.districtId) : "");
  const isEdit = !!item;
  const fn = isEdit ? () => updateChiefdom(item.id, { name, districtId: Number(districtId) })
                    : () => createChiefdom({ name, districtId: Number(districtId) });
  const mut = useMutation({ mutationFn: fn });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.chiefdoms() });
      toast({ title: isEdit ? "Chiefdom updated" : "Chiefdom added" }); onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Chiefdom" : "Add Chiefdom"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Bagruwa Chiefdom" required /></div>
          <div className="space-y-1.5">
            <Label>District *</Label>
            <Select value={districtId} onValueChange={setDist} required>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>{districts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !name || !districtId}>
              {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Chiefdom"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Distribution Site Modal ───────────────────────────────────────────────────
function DistSiteModal({ open, onClose, item, districts }: { open: boolean; onClose: () => void; item?: any; districts: any[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [districtId, setDist] = useState(item?.districtId ? String(item.districtId) : "");
  const [lat, setLat] = useState(item?.latitude != null ? String(item.latitude) : "");
  const [lng, setLng] = useState(item?.longitude != null ? String(item.longitude) : "");
  const [radius, setRadius] = useState(item?.geofenceRadius != null ? String(item.geofenceRadius) : "500");
  const isEdit = !!item;
  const fn = isEdit
    ? () => updateDistributionSite(item.id, { name, districtId: districtId ? Number(districtId) : null, latitude: lat ? Number(lat) : null, longitude: lng ? Number(lng) : null, geofenceRadius: Number(radius) })
    : () => createDistributionSite({ name, districtId: districtId ? Number(districtId) : null, latitude: lat ? Number(lat) : null, longitude: lng ? Number(lng) : null, geofenceRadius: Number(radius) });
  const mut = useMutation({ mutationFn: fn });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.distributionSites() });
      toast({ title: isEdit ? "Site updated" : "Site added" }); onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Distribution Site" : "Add Distribution Site"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="space-y-1.5"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Kakua Community Centre" required /></div>
          <div className="space-y-1.5">
            <Label>District</Label>
            <Select value={districtId} onValueChange={setDist}>
              <SelectTrigger><SelectValue placeholder="Select district…" /></SelectTrigger>
              <SelectContent>{districts.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Latitude</Label><Input value={lat} onChange={e => setLat(e.target.value)} placeholder="8.1234" type="number" step="any" /></div>
            <div className="space-y-1.5"><Label>Longitude</Label><Input value={lng} onChange={e => setLng(e.target.value)} placeholder="-11.5678" type="number" step="any" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Geofence Radius (metres)</Label>
            <Input value={radius} onChange={e => setRadius(e.target.value)} type="number" min="50" max="5000" placeholder="500" />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !name}>
              {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Input Item Modal ──────────────────────────────────────────────────────────
function InputItemModal({ open, onClose, item, valueChains }: { open: boolean; onClose: () => void; item?: any; valueChains: any[] }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [itemCode, setCode] = useState(item?.itemCode ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [vcId, setVc] = useState(item?.valueChainId ? String(item.valueChainId) : "");
  const [desc, setDesc] = useState(item?.description ?? "");
  const isEdit = !!item;
  const fn = isEdit
    ? () => updateInputItem(item.id, { name, unit, category: category || null, valueChainId: vcId ? Number(vcId) : null, description: desc || null })
    : () => createInputItem({ name, itemCode, unit, category: category || null, valueChainId: vcId ? Number(vcId) : null, description: desc || null });
  const mut = useMutation({ mutationFn: fn });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mut.mutateAsync();
      await qc.invalidateQueries({ queryKey: KEYS.inputItems() });
      toast({ title: isEdit ? "Item updated" : "Item added" }); onClose();
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Input Item" : "Add Input Item"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && <div className="space-y-1.5"><Label>Item Code *</Label><Input value={itemCode} onChange={e => setCode(e.target.value)} placeholder="SEED-RICE-001" required /></div>}
            <div className={`space-y-1.5 ${!isEdit ? "" : "col-span-2"}`}><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Improved Rice Seed" required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Unit *</Label><Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, bag, litre…" required /></div>
            <div className="space-y-1.5"><Label>Category</Label><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Seed, Fertiliser…" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Value Chain</Label>
            <Select value={vcId} onValueChange={setVc}>
              <SelectTrigger><SelectValue placeholder="Select value chain…" /></SelectTrigger>
              <SelectContent>{valueChains.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" /></div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={mut.isPending || !name || (!isEdit && !itemCode) || !unit}>
              {mut.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Toggle confirm dialog ─────────────────────────────────────────────────────
function ToggleConfirm({ item, entity, open, onClose, onConfirm }: { item: any; entity: string; open: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const active = !!item?.isActive;
  async function go() { setLoading(true); try { await onConfirm(); } finally { setLoading(false); onClose(); } }
  return (
    <AlertDialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{active ? "Deactivate" : "Activate"} {entity}?</AlertDialogTitle>
          <AlertDialogDescription>
            {active ? `"${item?.name}" will be hidden from selection in new records.` : `"${item?.name}" will become available for selection again.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={go} disabled={loading} className={active ? "bg-red-600 hover:bg-red-700" : "bg-green-700 hover:bg-green-800"}>
            {loading ? "Updating…" : active ? "Deactivate" : "Activate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const can = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();

  // modal state
  const [modal, setModal] = useState<{ type: string; item?: any } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{ entity: string; item: any; fn: () => Promise<any>; key: any[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  // system settings local state
  const [sysEdits, setSysEdits] = useState<Record<string, string>>({});
  const [sysSaving, setSysSaving] = useState(false);

  // data
  const { data: districts,   isLoading: loadDist }  = useQuery({ queryKey: KEYS.districts(),         queryFn: listDistricts });
  const { data: chiefdoms,   isLoading: loadChief }  = useQuery({ queryKey: KEYS.chiefdoms(),         queryFn: () => listChiefdoms() });
  const { data: valueChains, isLoading: loadVC }     = useQuery({ queryKey: KEYS.valueChains(),       queryFn: listValueChains });
  const { data: warehouses,  isLoading: loadWh }     = useQuery({ queryKey: KEYS.warehouses(),        queryFn: listWarehouses });
  const { data: sites,       isLoading: loadSites }  = useQuery({ queryKey: KEYS.distributionSites(), queryFn: listDistributionSites });
  const { data: inputItems,  isLoading: loadItems }  = useQuery({ queryKey: KEYS.inputItems(),        queryFn: listInputItems });
  const { data: sysList,     isLoading: loadSys }    = useQuery({ queryKey: KEYS.systemSettings(),    queryFn: listSystemSettings });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const chiefdomList:   any[] = Array.isArray(chiefdoms)   ? chiefdoms   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];
  const warehouseList:  any[] = Array.isArray(warehouses)  ? warehouses  : [];
  const siteList:       any[] = Array.isArray(sites)       ? sites       : [];
  const itemList:       any[] = Array.isArray(inputItems)  ? inputItems  : [];
  const settings:       any[] = Array.isArray(sysList)     ? sysList     : [];

  // current system settings merged with edits
  function sysVal(key: string) {
    return sysEdits[key] ?? settings.find(s => s.key === key)?.value ?? "";
  }

  async function saveSys() {
    setSysSaving(true);
    try {
      await saveSystemSettings(sysEdits);
      await qc.invalidateQueries({ queryKey: KEYS.systemSettings() });
      setSysEdits({});
      toast({ title: "Settings saved" });
    } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
    finally { setSysSaving(false); }
  }

  // action helpers
  function openToggle(entity: string, item: any, fn: () => Promise<any>, key: any[]) {
    setToggleTarget({ entity, item, fn, key });
  }

  const loadingRow = (cols: number) => Array.from({ length: 3 }).map((_, i) => (
    <TableRow key={i}>{Array.from({ length: cols }).map((__, j) => (
      <TableCell key={j} className={j === 0 ? "pl-4" : j === cols - 1 ? "pr-4" : ""}><Skeleton className="h-4 w-full" /></TableCell>
    ))}</TableRow>
  ));

  const emptyRow = (cols: number, msg: string) => (
    <TableRow><TableCell colSpan={cols} className="h-24 text-center text-sm text-muted-foreground">{msg}</TableCell></TableRow>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Settings & Master Data" subtitle="Configure locations, value chains, warehouses and system defaults." />

      <Tabs defaultValue="warehouses">
        <TabsList className="h-8 flex-wrap">
          <TabsTrigger value="warehouses"    className="text-xs"><Warehouse className="h-3 w-3 mr-1" />Warehouses</TabsTrigger>
          <TabsTrigger value="value-chains"  className="text-xs"><Layers    className="h-3 w-3 mr-1" />Value Chains</TabsTrigger>
          <TabsTrigger value="districts"     className="text-xs"><MapPin    className="h-3 w-3 mr-1" />Districts</TabsTrigger>
          <TabsTrigger value="chiefdoms"     className="text-xs"><MapPin    className="h-3 w-3 mr-1" />Chiefdoms</TabsTrigger>
          <TabsTrigger value="dist-sites"    className="text-xs"><Navigation className="h-3 w-3 mr-1" />Dist. Sites</TabsTrigger>
          <TabsTrigger value="input-items"   className="text-xs"><Leaf      className="h-3 w-3 mr-1" />Input Items</TabsTrigger>
          <TabsTrigger value="system"        className="text-xs"><Settings2 className="h-3 w-3 mr-1" />System</TabsTrigger>
        </TabsList>

        {/* ── Warehouses ────────────────────────────────────────────────────── */}
        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Warehouses</CardTitle>
                {!loadWh && <span className="text-xs text-muted-foreground">{warehouseList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("warehouses.csv", ["code","name","districtName","address","isActive"], warehouseList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <>
                    <ImportButton template="code,name,address" onImport={async rows => {
                      const r = await importWarehouses(rows);
                      await qc.invalidateQueries({ queryKey: KEYS.warehouses() });
                      toast({ title: `Imported ${r.inserted} warehouses`, description: r.errors?.length ? r.errors.join("; ") : undefined });
                    }} />
                    <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "warehouse" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </>
                )}
              </div>
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
                    {can.manageSettings && <TableHead className="pr-4 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadWh ? loadingRow(can.manageSettings ? 6 : 5)
                  : warehouseList.length > 0 ? warehouseList.map((w: any) => (
                    <TableRow key={w.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{w.code}</TableCell>
                      <TableCell className="text-sm font-medium">{w.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{w.districtName ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{w.address ?? "—"}</TableCell>
                      <TableCell><StatusBadge active={!!w.isActive} /></TableCell>
                      {can.manageSettings && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal({ type: "warehouse", item: w })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title={w.isActive ? "Deactivate" : "Activate"}
                              onClick={() => openToggle("Warehouse", w, () => toggleWarehouse(w.id), KEYS.warehouses())}>
                              {w.isActive ? <PowerOff className="h-3.5 w-3.5 text-red-500" /> : <Power className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : emptyRow(can.manageSettings ? 6 : 5, "No warehouses configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Value Chains ──────────────────────────────────────────────────── */}
        <TabsContent value="value-chains" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Value Chains</CardTitle>
                {!loadVC && <span className="text-xs text-muted-foreground">{valueChainList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("value-chains.csv", ["name","description","isActive"], valueChainList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "value-chain" })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadVC ? loadingRow(can.manageSettings ? 4 : 3)
                  : valueChainList.length > 0 ? valueChainList.map((vc: any) => (
                    <TableRow key={vc.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 text-sm font-medium">{vc.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{vc.description ?? "—"}</TableCell>
                      <TableCell><StatusBadge active={!!vc.isActive} /></TableCell>
                      {can.manageSettings && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal({ type: "value-chain", item: vc })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => openToggle("Value Chain", vc, () => toggleValueChain(vc.id), KEYS.valueChains())}>
                              {vc.isActive ? <PowerOff className="h-3.5 w-3.5 text-red-500" /> : <Power className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : emptyRow(can.manageSettings ? 4 : 3, "No value chains configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Districts ─────────────────────────────────────────────────────── */}
        <TabsContent value="districts" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Districts</CardTitle>
                {!loadDist && <span className="text-xs text-muted-foreground">{districtList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("districts.csv", ["code","name"], districtList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "district" })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                )}
              </div>
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
                  {loadDist ? loadingRow(2)
                  : districtList.length > 0 ? districtList.map((d: any) => (
                    <TableRow key={d.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{d.code}</TableCell>
                      <TableCell className="pr-4 text-sm">{d.name}</TableCell>
                    </TableRow>
                  )) : emptyRow(2, "No districts configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Chiefdoms ─────────────────────────────────────────────────────── */}
        <TabsContent value="chiefdoms" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Chiefdoms</CardTitle>
                {!loadChief && <span className="text-xs text-muted-foreground">{chiefdomList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("chiefdoms.csv", ["name","districtName"], chiefdomList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "chiefdom" })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadChief ? loadingRow(can.manageSettings ? 3 : 2)
                  : chiefdomList.length > 0 ? chiefdomList.map((c: any) => (
                    <TableRow key={c.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 text-sm font-medium">{c.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.districtName ?? "—"}</TableCell>
                      {can.manageSettings && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal({ type: "chiefdom", item: c })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => setDeleteTarget(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : emptyRow(can.manageSettings ? 3 : 2, "No chiefdoms configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Distribution Sites ────────────────────────────────────────────── */}
        <TabsContent value="dist-sites" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Navigation className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Distribution Sites</CardTitle>
                {!loadSites && <span className="text-xs text-muted-foreground">{siteList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("distribution-sites.csv", ["name","districtName","latitude","longitude","geofenceRadius","isActive"], siteList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <>
                    <ImportButton template="name,latitude,longitude,geofence_radius" onImport={async rows => {
                      const r = await importDistributionSites(rows);
                      await qc.invalidateQueries({ queryKey: KEYS.distributionSites() });
                      toast({ title: `Imported ${r.inserted} sites`, description: r.errors?.length ? r.errors.join("; ") : undefined });
                    }} />
                    <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "dist-site" })}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead className="hidden md:table-cell">District</TableHead>
                    <TableHead className="hidden lg:table-cell">Coordinates</TableHead>
                    <TableHead className="hidden lg:table-cell">Radius</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadSites ? loadingRow(can.manageSettings ? 6 : 5)
                  : siteList.length > 0 ? siteList.map((s: any) => (
                    <TableRow key={s.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 text-sm font-medium">{s.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{s.districtName ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground font-mono">
                        {s.latitude != null && s.longitude != null ? `${Number(s.latitude).toFixed(4)}, ${Number(s.longitude).toFixed(4)}` : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{s.geofenceRadius ? `${s.geofenceRadius}m` : "—"}</TableCell>
                      <TableCell><StatusBadge active={!!s.isActive} /></TableCell>
                      {can.manageSettings && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal({ type: "dist-site", item: s })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => openToggle("Distribution Site", s, () => toggleDistributionSite(s.id), KEYS.distributionSites())}>
                              {s.isActive ? <PowerOff className="h-3.5 w-3.5 text-red-500" /> : <Power className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : emptyRow(can.manageSettings ? 6 : 5, "No distribution sites configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Input Items ───────────────────────────────────────────────────── */}
        <TabsContent value="input-items" className="mt-4">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Leaf className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Input Items</CardTitle>
                {!loadItems && <span className="text-xs text-muted-foreground">{itemList.length}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportCsv("input-items.csv", ["itemCode","name","unit","category","valueChainName","isActive"], itemList)}>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
                {can.manageSettings && (
                  <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={() => setModal({ type: "input-item" })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4 w-[120px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Unit</TableHead>
                    <TableHead className="hidden md:table-cell">Category</TableHead>
                    <TableHead className="hidden lg:table-cell">Value Chain</TableHead>
                    <TableHead>Status</TableHead>
                    {can.manageSettings && <TableHead className="pr-4 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadItems ? loadingRow(can.manageSettings ? 7 : 6)
                  : itemList.length > 0 ? itemList.map((it: any) => (
                    <TableRow key={it.id} className="hover:bg-muted/40">
                      <TableCell className="pl-4 font-mono text-xs text-muted-foreground">{it.itemCode}</TableCell>
                      <TableCell className="text-sm font-medium">{it.name}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{it.unit}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{it.category ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{it.valueChainName ?? "—"}</TableCell>
                      <TableCell><StatusBadge active={!!it.isActive} /></TableCell>
                      {can.manageSettings && (
                        <TableCell className="pr-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setModal({ type: "input-item", item: it })}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7"
                              onClick={() => openToggle("Input Item", it, () => toggleInputItem(it.id), KEYS.inputItems())}>
                              {it.isActive ? <PowerOff className="h-3.5 w-3.5 text-red-500" /> : <Power className="h-3.5 w-3.5 text-green-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )) : emptyRow(can.manageSettings ? 7 : 6, "No input items configured")}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── System Settings ───────────────────────────────────────────────── */}
        <TabsContent value="system" className="mt-4">
          <Card>
            <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">System Defaults</CardTitle>
              </div>
              {can.manageSettings && Object.keys(sysEdits).length > 0 && (
                <Button size="sm" className="h-7 text-xs bg-green-700 hover:bg-green-800 text-white" onClick={saveSys} disabled={sysSaving}>
                  {sysSaving ? "Saving…" : "Save Changes"}
                </Button>
              )}
            </CardHeader>
            <CardContent className="px-4 pb-6">
              {loadSys ? (
                <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : settings.length > 0 ? (
                <div className="space-y-5 max-w-lg">
                  {settings.map(s => {
                    const isBoolean = s.key === "otp_enabled" || s.key === "face_verification_enabled" || (s as any).type === "boolean";
                    const boolVal = sysEdits[s.key] != null ? sysEdits[s.key] === "true" : s.value === "true";
                    return (
                      <div key={s.key} className="space-y-1.5">
                        <Label className="text-sm font-medium capitalize">{s.key.replace(/_/g, " ")}</Label>
                        {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                        {isBoolean ? (
                          <div className="flex items-center gap-3 pt-0.5">
                            <Switch
                              checked={boolVal}
                              onCheckedChange={v => setSysEdits(prev => ({ ...prev, [s.key]: String(v) }))}
                              disabled={!can.manageSettings}
                            />
                            <span className={`text-sm font-medium ${boolVal ? "text-emerald-700" : "text-muted-foreground"}`}>
                              {boolVal ? "Enabled" : "Disabled"}
                            </span>
                            {sysEdits[s.key] != null && (
                              <span className="text-xs text-amber-600 font-medium">unsaved</span>
                            )}
                          </div>
                        ) : (
                          <Input
                            value={sysVal(s.key)}
                            onChange={e => setSysEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                            disabled={!can.manageSettings}
                            className={sysEdits[s.key] != null ? "border-amber-400 ring-1 ring-amber-300" : ""}
                          />
                        )}
                      </div>
                    );
                  })}
                  {can.manageSettings && Object.keys(sysEdits).length > 0 && (
                    <div className="flex gap-2 pt-2">
                      <Button className="bg-green-700 hover:bg-green-800 text-white" onClick={saveSys} disabled={sysSaving}>
                        {sysSaving ? "Saving…" : "Save Changes"}
                      </Button>
                      <Button variant="outline" onClick={() => setSysEdits({})}>Discard</Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No system settings found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <WarehouseModal
        key={`wh-${modal?.item?.id ?? "new"}`}
        open={modal?.type === "warehouse"}
        onClose={() => setModal(null)}
        item={modal?.item}
        districts={districtList}
      />
      <ValueChainModal
        key={`vc-${modal?.item?.id ?? "new"}`}
        open={modal?.type === "value-chain"}
        onClose={() => setModal(null)}
        item={modal?.item}
      />
      <DistrictModal
        open={modal?.type === "district"}
        onClose={() => setModal(null)}
      />
      <ChiefdomModal
        key={`ch-${modal?.item?.id ?? "new"}`}
        open={modal?.type === "chiefdom"}
        onClose={() => setModal(null)}
        item={modal?.item}
        districts={districtList}
      />
      <DistSiteModal
        key={`ds-${modal?.item?.id ?? "new"}`}
        open={modal?.type === "dist-site"}
        onClose={() => setModal(null)}
        item={modal?.item}
        districts={districtList}
      />
      <InputItemModal
        key={`ii-${modal?.item?.id ?? "new"}`}
        open={modal?.type === "input-item"}
        onClose={() => setModal(null)}
        item={modal?.item}
        valueChains={valueChainList}
      />

      {/* Toggle confirm */}
      {toggleTarget && (
        <ToggleConfirm
          open={true}
          entity={toggleTarget.entity}
          item={toggleTarget.item}
          onClose={() => setToggleTarget(null)}
          onConfirm={async () => {
            await toggleTarget.fn();
            await qc.invalidateQueries({ queryKey: toggleTarget.key });
          }}
        />
      )}

      {/* Delete chiefdom confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chiefdom?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={async () => {
              try {
                await deleteChiefdom(deleteTarget.id);
                await qc.invalidateQueries({ queryKey: KEYS.chiefdoms() });
                toast({ title: "Chiefdom deleted" });
              } catch (err: any) { toast({ title: "Failed", description: err.message, variant: "destructive" }); }
              setDeleteTarget(null);
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
