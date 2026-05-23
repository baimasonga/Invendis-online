import { useState, useCallback } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  importDispatch, listCampaigns, listVehicles, listDrivers, listWarehouses,
  listFieldOfficers, listInputItems, KEYS,
} from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, ChevronRight, ChevronLeft, AlertCircle, Truck, Car, Download, Printer, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { open: boolean; onClose: () => void; }

interface ParsedRow {
  community: string;
  district: string;
  chiefdom: string;
  contactPerson: string | null;
  contactPhone: string | null;
  quantities: number[];
}

interface ColMapping {
  colIndex: number;
  name: string;
  unit: string;
  itemId: number | null;
}

type VehicleMode = "office" | "hired";

const UNITS = ["pcs", "kg", "bags", "units", "sets", "litres"];
const STEP_LABELS = ["Upload", "Name Items", "Preview", "Dispatch Setup", "Done"];

export function ImportManifestModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const importMutation = useMutation({ mutationFn: importDispatch });

  const [step, setStep] = useState(1);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColMapping[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const [campaignId, setCampaignId]         = useState("");
  const [warehouseId, setWarehouseId]       = useState("");
  const [vehicleMode, setVehicleMode]       = useState<VehicleMode>("office");
  const [vehicleId, setVehicleId]           = useState("");
  const [driverId, setDriverId]             = useState("");
  const [hiredPlate, setHiredPlate]         = useState("");
  const [hiredDriver, setHiredDriver]       = useState("");
  const [notes, setNotes]                   = useState("");
  const [fieldOfficerId, setFieldOfficerId] = useState("");
  const [stockShortfalls, setStockShortfalls] = useState<any[] | null>(null);
  const [importResult, setImportResult]       = useState<any>(null);

  const { data: campaignsData } = useQuery({ queryKey: KEYS.campaigns(),      queryFn: () => listCampaigns(1, 100) });
  const { data: vehiclesData }  = useQuery({ queryKey: KEYS.vehicles(),       queryFn: () => listVehicles(1, 200) });
  const { data: driversData }   = useQuery({ queryKey: KEYS.drivers(),        queryFn: () => listDrivers(1, 200) });
  const { data: warehouses }    = useQuery({ queryKey: KEYS.warehouses(),     queryFn: listWarehouses });
  const { data: officersList }  = useQuery({ queryKey: KEYS.fieldOfficers(),  queryFn: listFieldOfficers });
  const { data: existingItems } = useQuery({ queryKey: ["inputItems"],        queryFn: listInputItems });

  const campaigns:     any[] = (campaignsData as any)?.data ?? [];
  const vehicleList:   any[] = (vehiclesData as any)?.data  ?? [];
  const driverList:    any[] = (driversData as any)?.data   ?? [];
  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];
  const officers:      any[] = Array.isArray(officersList) ? officersList : [];
  const itemList:      any[] = Array.isArray(existingItems) ? existingItems : [];

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

        const headerRowIdx = raw.findIndex((row: any[]) =>
          row.some((cell: any) => typeof cell === "string" && cell.toString().toLowerCase().includes("district"))
        );
        if (headerRowIdx < 0) {
          toast({ title: "Parse error", description: "Could not find a header row with a 'District' column.", variant: "destructive" });
          return;
        }
        const headerRow = raw[headerRowIdx] as any[];

        const districtIdx      = headerRow.findIndex((h: any) => h?.toString().toLowerCase() === "district");
        const chiefdomIdx      = headerRow.findIndex((h: any) => h?.toString().toLowerCase() === "chiefdom");
        const communityIdx     = headerRow.findIndex((h: any) => h?.toString().toLowerCase() === "community");
        const distributionIdx  = headerRow.findIndex((h: any) => h?.toString().toLowerCase() === "distribution");
        const contactNameIdx   = headerRow.findIndex((h: any) => typeof h === "string" && h.toLowerCase().includes("contact person"));
        const contactPhoneIdx  = headerRow.findIndex((h: any) => typeof h === "string" && (h.toLowerCase().includes("contact #") || h.toLowerCase().includes("contact number")));

        if (communityIdx < 0) {
          toast({ title: "Parse error", description: "Could not detect a Community column.", variant: "destructive" });
          return;
        }

        // Distribution column is optional — use it as right boundary when present;
        // otherwise fall back to the first Contact column, or end of header row.
        const toolEndIdx =
          distributionIdx >= 0 ? distributionIdx :
          contactNameIdx  >= 0 ? contactNameIdx  :
          contactPhoneIdx >= 0 ? contactPhoneIdx  :
          headerRow.length;

        const toolHeaders: string[] = [];
        for (let i = communityIdx + 1; i < toolEndIdx; i++) {
          toolHeaders.push(headerRow[i]?.toString() ?? `Item ${i - communityIdx}`);
        }
        if (toolHeaders.length === 0) {
          toast({ title: "Parse error", description: "No tool/item columns found after the Community column.", variant: "destructive" });
          return;
        }

        const rows: ParsedRow[] = [];
        for (let i = headerRowIdx + 1; i < raw.length; i++) {
          const row = raw[i] as any[];
          const communityVal = row[communityIdx];
          const distVal = districtIdx >= 0 ? row[districtIdx] : null;
          if (communityVal === null || communityVal === undefined || communityVal === "") continue;
          if (typeof communityVal === "string" && (communityVal.toLowerCase().includes("total") || communityVal.toLowerCase().includes("grand"))) continue;
          if (typeof distVal === "string" && (distVal.toLowerCase().includes("total") || distVal.toLowerCase().includes("grand"))) continue;

          const quantities: number[] = [];
          for (let j = communityIdx + 1; j < toolEndIdx; j++) {
            quantities.push(Number(row[j] ?? 0));
          }
          rows.push({
            community:     row[communityIdx]?.toString() ?? "",
            district:      distVal?.toString() ?? "",
            chiefdom:      chiefdomIdx >= 0 ? (row[chiefdomIdx]?.toString() ?? "") : "",
            contactPerson: contactNameIdx >= 0  ? (row[contactNameIdx]?.toString()  ?? null) : null,
            contactPhone:  contactPhoneIdx >= 0 ? (row[contactPhoneIdx]?.toString() ?? null) : null,
            quantities,
          });
        }

        if (rows.length === 0) {
          toast({ title: "No data", description: "No community rows could be parsed from this file.", variant: "destructive" });
          return;
        }

        setParsedRows(rows);
        setColumnMapping(toolHeaders.map((name, i) => ({
          colIndex: i,
          name: name.toLowerCase().startsWith("tools col") ? "" : name,
          unit: "pcs",
          itemId: null,
        })));
        setStep(2);
      } catch (err: any) {
        toast({ title: "File error", description: err.message, variant: "destructive" });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, []);

  function reset() {
    setStep(1); setParsedRows([]); setColumnMapping([]);
    setCampaignId(""); setWarehouseId(""); setVehicleMode("office");
    setVehicleId(""); setDriverId(""); setHiredPlate(""); setHiredDriver("");
    setNotes(""); setFieldOfficerId("");
    setStockShortfalls(null); setImportResult(null);
  }

  function handleClose() { reset(); onClose(); }

  const colTotals = columnMapping.map((_, i) =>
    parsedRows.reduce((sum, row) => sum + (row.quantities[i] ?? 0), 0)
  );
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);
  const districts  = [...new Set(parsedRows.map(r => r.district))];

  function updateCol(i: number, patch: Partial<ColMapping>) {
    setColumnMapping(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c));
  }

  function downloadTemplate() {
    const activeItems = itemList.filter((it: any) => it.isActive !== false && it.isActive !== 0);
    const toolCols = activeItems.length ? activeItems.map((it: any) => it.name || "") : ["Tool 1", "Tool 2"];
    const headers = ["No", "District", "Chiefdom", "Community", ...toolCols, "Distribution (optional)", "Contact Person", "Contact #"];
    const example = [1, "Bo", "Kakua", "Gangama", ...toolCols.map(() => 12), "", "Firstname Lastname", "078-000000"];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Distribution Plan");
    XLSX.writeFile(wb, "dispatch-plan-template.xlsx");
  }

  function printLabels(communities: any[]) {
    const win = window.open("", "_blank");
    if (!win) {
      toast({ title: "Popup blocked", description: "Please allow popups for this site to print labels.", variant: "destructive" });
      return;
    }
    const rows = communities.map((c: any) => `
      <div class="label">
        <p class="community">${c.community}</p>
        <p class="district">${c.district}</p>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(c.barcodeToken)}" alt="QR" width="96" height="96" />
        <p class="code">${c.farmerCode}</p>
      </div>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels</title>
      <style>
        body{font-family:sans-serif;margin:10px}
        h3{margin:0 0 10px;font-size:14px}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
        .label{border:1px solid #ccc;padding:10px;text-align:center;break-inside:avoid;border-radius:4px;page-break-inside:avoid}
        .community{font-weight:bold;font-size:11px;margin:0 0 2px}
        .district{font-size:10px;color:#666;margin:0 0 6px}
        .code{font-family:monospace;font-size:9px;color:#444;margin:6px 0 0}
        @media print{@page{margin:10mm}}
      </style></head>
      <body>
        <h3>Barcode Labels — ${communities.length} communities</h3>
        <div class="grid">${rows}</div>
      </body></html>`);
    setTimeout(() => win.print(), 700);
  }

  async function handleImport(force = false) {
    if (!campaignId || !warehouseId) {
      toast({ title: "Required fields", description: "Select a campaign and warehouse to continue.", variant: "destructive" });
      return;
    }
    const payload: any = {
      campaignId:     Number(campaignId),
      warehouseId:    Number(warehouseId),
      vehicleType:    vehicleMode,
      fieldOfficerId: fieldOfficerId ? Number(fieldOfficerId) : undefined,
      notes:          notes || undefined,
      force:          force || undefined,
      columns:        columnMapping.map(c => ({ ...c, name: c.name.trim() || `Item ${c.colIndex + 1}` })),
      rows:           parsedRows,
    };
    if (vehicleMode === "office") {
      if (vehicleId) payload.vehicleId = Number(vehicleId);
      if (driverId)  payload.driverId  = Number(driverId);
    } else {
      payload.hiredPlate      = hiredPlate;
      payload.hiredDriverName = hiredDriver;
    }

    try {
      const result = await importMutation.mutateAsync(payload);
      await qc.invalidateQueries({ queryKey: ["dispatches"] });
      await qc.invalidateQueries({ queryKey: ["farmers"] });
      setImportResult(result);
      setStep(5);
    } catch (err: any) {
      if (err.message === "insufficient_stock" && err.shortfalls) {
        setStockShortfalls(err.shortfalls);
        return;
      }
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && handleClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-0">
            <DialogTitle className="text-lg">Import Dispatch from Excel</DialogTitle>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex items-center px-6 py-4 gap-0">
            {STEP_LABELS.map((label, i) => {
              const n = i + 1;
              const active  = n === step;
              const done    = n < step;
              return (
                <div key={n} className="flex items-center min-w-0">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className={cn(
                      "w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center",
                      active ? "bg-primary text-primary-foreground" :
                      done   ? "bg-emerald-600 text-white" :
                               "bg-muted text-muted-foreground",
                    )}>
                      {done ? "✓" : n}
                    </div>
                    <span className={cn("text-xs hidden sm:inline", active ? "font-semibold" : "text-muted-foreground")}>
                      {label}
                    </span>
                  </div>
                  {i < STEP_LABELS.length - 1 && <div className="flex-1 h-px bg-border mx-2" />}
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-6">

            {/* ── Step 1: Upload ── */}
            {step === 1 && (
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Upload your filled Excel distribution plan. Communities are auto-registered as group beneficiaries
                  with barcodes, and new tool types are added to Inventory automatically.
                </p>

                <Button variant="outline" size="sm" className="w-full gap-2 justify-center" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" /> Download Excel Template
                </Button>

                <div
                  className={cn(
                    "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors select-none",
                    isDragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50",
                  )}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("xls-upload-input")?.click()}
                >
                  <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="font-semibold text-sm">Drop Excel file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports .xlsx and .xls</p>
                  <input id="xls-upload-input" type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
                </div>
                <div className="rounded-md bg-muted/60 p-3 space-y-1 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground text-xs">Expected column order:</p>
                  <p>No · District · Chiefdom · Community · [Tool columns] · <span className="italic">Distribution (optional)</span> · Contact Person · Contact #</p>
                  <p>Subtotal rows (e.g. "Bo Total", "GRAND TOTAL") are skipped automatically. Distribution date can be set later by editing the manifest.</p>
                </div>
              </div>
            )}

            {/* ── Step 2: Name Items ── */}
            {step === 2 && (
              <div className="space-y-4 py-3">
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">
                    <span className="font-semibold">{parsedRows.length} communities</span> detected across{" "}
                    <span className="font-semibold">{districts.length} district(s)</span>.
                    Give each tool column a proper name — new items will be added to Inventory automatically.
                    Link to an existing item to avoid duplicates.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                    <div className="col-span-1">Total</div>
                    <div className="col-span-5">Item Name *</div>
                    <div className="col-span-2">Unit</div>
                    <div className="col-span-4">Link to Existing</div>
                  </div>
                  {columnMapping.map((col, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-1 flex items-center">
                        <Badge variant="secondary" className="text-[10px] px-1.5">{colTotals[i]}</Badge>
                      </div>
                      <div className="col-span-5">
                        <Input
                          placeholder="e.g. Cutlass, Hoe, Watering Can…"
                          value={col.name}
                          onChange={e => updateCol(i, { name: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="col-span-2">
                        <Select value={col.unit} onValueChange={v => updateCol(i, { unit: v })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-4">
                        <Select
                          value={col.itemId ? String(col.itemId) : "new"}
                          onValueChange={v => updateCol(i, { itemId: v === "new" ? null : Number(v) })}
                        >
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">✦ Create new item</SelectItem>
                            {itemList.map((it: any) => (
                              <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 3: Preview ── */}
            {step === 3 && (
              <div className="space-y-3 py-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: parsedRows.length, label: "Communities" },
                    { value: districts.length,  label: "Districts" },
                    { value: grandTotal,         label: "Total Units" },
                  ].map(({ value, label }) => (
                    <div key={label} className="rounded-lg border p-3 text-center">
                      <div className="text-2xl font-bold">{value}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border overflow-auto max-h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs sticky left-0 bg-background">Community</TableHead>
                        <TableHead className="text-xs">District</TableHead>
                        <TableHead className="text-xs">Contact</TableHead>
                        {columnMapping.map((c, i) => (
                          <TableHead key={i} className="text-xs text-right whitespace-nowrap">
                            {c.name || `Item ${i + 1}`}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-medium">{row.community}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.district}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.contactPerson ?? "—"}</TableCell>
                          {row.quantities.map((q, j) => (
                            <TableCell key={j} className="text-xs text-right tabular-nums">
                              {q > 0 ? q : <span className="text-muted-foreground/50">—</span>}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50">
                        <TableCell className="text-xs font-bold" colSpan={3}>TOTAL</TableCell>
                        {colTotals.map((t, i) => (
                          <TableCell key={i} className="text-xs text-right tabular-nums font-bold">{t}</TableCell>
                        ))}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-0.5">
                  <p className="font-semibold">What will be created on import:</p>
                  <ul className="list-disc list-inside space-y-0.5 mt-1">
                    <li>
                      {parsedRows.length} group beneficiaries with auto-generated barcodes (existing communities will be reused)
                    </li>
                    <li>
                      {columnMapping.filter(c => !c.itemId).length} new inventory item(s) ·{" "}
                      {columnMapping.filter(c => c.itemId).length} linked to existing items
                    </li>
                    <li>1 draft dispatch manifest with {columnMapping.length} item line(s) totalling {grandTotal} units</li>
                    <li>{parsedRows.length} campaign allocations (one per community)</li>
                  </ul>
                </div>
              </div>
            )}

            {/* ── Step 4: Dispatch Setup ── */}
            {step === 4 && (
              <div className="space-y-4 py-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Campaign *</Label>
                    <Select value={campaignId} onValueChange={setCampaignId}>
                      <SelectTrigger><SelectValue placeholder="Select campaign" /></SelectTrigger>
                      <SelectContent>
                        {campaigns.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Source Warehouse *</Label>
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                      <SelectContent>
                        {warehouseList.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Vehicle Type</Label>
                  <div className="flex gap-2">
                    {(["office", "hired"] as VehicleMode[]).map(mode => (
                      <button
                        key={mode} type="button"
                        onClick={() => setVehicleMode(mode)}
                        className={cn(
                          "flex-1 flex items-center gap-2 justify-center rounded-lg border p-2.5 text-sm transition-colors",
                          vehicleMode === mode
                            ? "border-primary bg-primary/5 text-primary font-medium"
                            : "border-muted hover:border-primary/40",
                        )}
                      >
                        {mode === "office" ? <Car className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                        {mode === "office" ? "Office Vehicle" : "Hired Truck"}
                      </button>
                    ))}
                  </div>
                </div>

                {vehicleMode === "office" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Vehicle</Label>
                      <Select value={vehicleId} onValueChange={setVehicleId}>
                        <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                        <SelectContent>
                          {vehicleList.map((v: any) => (
                            <SelectItem key={v.id} value={String(v.id)}>{v.plateNumber ?? v.plate_number}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Driver</Label>
                      <Select value={driverId} onValueChange={setDriverId}>
                        <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                        <SelectContent>
                          {driverList.map((d: any) => (
                            <SelectItem key={d.id} value={String(d.id)}>{d.fullName ?? d.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Plate Number</Label>
                      <Input placeholder="e.g. SL 1234" value={hiredPlate} onChange={e => setHiredPlate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Driver Name</Label>
                      <Input placeholder="Driver full name" value={hiredDriver} onChange={e => setHiredDriver(e.target.value)} />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Field Officer <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Select value={fieldOfficerId} onValueChange={setFieldOfficerId}>
                      <SelectTrigger><SelectValue placeholder="Assign officer" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {officers.map((o: any) => (
                          <SelectItem key={o.id} value={String(o.id)}>{o.fullName ?? o.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input placeholder="Any notes for this dispatch…" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 5: Done ── */}
            {step === 5 && importResult && (
              <div className="py-10 flex flex-col items-center gap-5 text-center">
                <CheckCircle2 className="h-14 w-14 text-emerald-600" />
                <div>
                  <p className="text-lg font-semibold">Import Successful</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Manifest{" "}
                    <span className="font-mono font-medium">{importResult.manifestCode}</span>{" "}
                    created — {importResult.totalCommunities} communities,{" "}
                    {importResult.farmersCreated ?? 0} new beneficiaries
                  </p>
                </div>
                {importResult.communities?.length > 0 && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => printLabels(importResult.communities)}
                  >
                    <Printer className="h-4 w-4" />
                    Print Barcode Labels ({importResult.communities.length})
                  </Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t flex gap-2">
            {step > 1 && step < 5 && (
              <Button variant="outline" onClick={() => setStep(s => s - 1)} className="gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            )}
            <div className="flex-1" />
            {step === 5 ? (
              <Button onClick={handleClose}>Close</Button>
            ) : step < 4 ? (
              <Button
                onClick={() => {
                  if (step === 2) {
                    const blank = columnMapping.findIndex(c => !c.name.trim() && !c.itemId);
                    if (blank >= 0) {
                      toast({ title: "Name required", description: `Column ${blank + 1} needs a name or must be linked to an existing item.`, variant: "destructive" });
                      return;
                    }
                  }
                  setStep(s => s + 1);
                }}
                className="gap-1"
                disabled={step === 1}
              >
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button
                onClick={() => handleImport()}
                disabled={importMutation.isPending || !campaignId || !warehouseId}
                className="gap-2 bg-green-700 hover:bg-green-800 text-white"
              >
                {importMutation.isPending ? "Importing…" : `Import & Create Manifest (${parsedRows.length} communities)`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock Shortfall Warning */}
      <AlertDialog open={!!stockShortfalls} onOpenChange={v => { if (!v) setStockShortfalls(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" /> Insufficient Stock
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3 text-sm">The following items have insufficient stock in the selected warehouse:</p>
                <table className="w-full text-xs border rounded-md overflow-hidden mb-3">
                  <thead>
                    <tr className="bg-muted">
                      <th className="p-2 text-left font-medium">Item</th>
                      <th className="p-2 text-right font-medium">Required</th>
                      <th className="p-2 text-right font-medium">Available</th>
                      <th className="p-2 text-right font-medium">Shortfall</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockShortfalls?.map((s: any) => (
                      <tr key={s.itemName} className="border-t">
                        <td className="p-2">{s.itemName}</td>
                        <td className="p-2 text-right font-medium tabular-nums">{s.needed}</td>
                        <td className="p-2 text-right tabular-nums">{s.available}</td>
                        <td className="p-2 text-right text-red-600 font-medium tabular-nums">{s.needed - s.available}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                  You can proceed anyway or cancel to adjust quantities. Force-importing will create the manifest regardless.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setStockShortfalls(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setStockShortfalls(null); handleImport(true); }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Import Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
