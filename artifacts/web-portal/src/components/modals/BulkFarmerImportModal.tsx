import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { bulkImportFarmers, listDistricts, listValueChains, bulkCheckDuplicates, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Download, Printer, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { open: boolean; onClose: () => void; }

interface FarmerRow {
  firstName: string;
  lastName: string;
  gender: string;
  phone: string;
  beneficiaryType: string;
  farmerGroup: string;
  groupSize: number | null;
}

interface DuplicateInfo {
  phone: string;
  farmerCode: string;
  name: string;
}

const STEP_LABELS = ["Upload", "Setup & Preview", "Done"];
const EXCEL_COLS  = ["First Name", "Last Name", "Gender", "Phone", "Type", "Group Name", "Group Size"];

function parseIntraBatchRow(matchedFarmerCode: string): number | null {
  const m = matchedFarmerCode.match(/duplicate within import file \(row (\d+)\)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function BulkFarmerImportModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const importMutation = useMutation({ mutationFn: bulkImportFarmers });

  const [step, setStep]               = useState(1);
  const [rows, setRows]               = useState<FarmerRow[]>([]);
  const [isDragOver, setIsDragOver]   = useState(false);
  const [districtId, setDistrictId]   = useState("");
  const [valueChainId, setValueChainId] = useState("");
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    duplicates: Array<{ row: number; name: string; phone: string; matchedFarmerCode: string }>;
    farmers: any[];
  } | null>(null);

  const [duplicateMap, setDuplicateMap] = useState<Map<string, DuplicateInfo>>(new Map());
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  // phone → first row number (1-based) for phones that appear 2+ times within the file
  const [intraFileDupeMap, setIntraFileDupeMap] = useState<Map<string, number>>(new Map());

  const { data: districts }   = useQuery({ queryKey: KEYS.districts(),    queryFn: listDistricts });
  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(),  queryFn: listValueChains });

  const districtList:   any[] = Array.isArray(districts)   ? districts   : [];
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  function reset() {
    setStep(1); setRows([]); setDistrictId(""); setValueChainId(""); setImportResult(null);
    setDuplicateMap(new Map()); setCheckingDuplicates(false); setIntraFileDupeMap(new Map());
  }
  function handleClose() { reset(); onClose(); }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      EXCEL_COLS,
      ["Amadou", "Kamara", "Male", "078-123456", "individual", "", ""],
      ["", "", "", "", "group", "Gangama Community", "15"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Farmers");
    XLSX.writeFile(wb, "farmer-bulk-import-template.xlsx");
  }

  function parseFile(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const raw  = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

        const headerIdx = raw.findIndex((r: any[]) =>
          r.some((c: any) => typeof c === "string" && c.toLowerCase().includes("first"))
        );
        if (headerIdx < 0) {
          toast({ title: "Parse error", description: "Could not find a header row with 'First Name'.", variant: "destructive" });
          return;
        }

        const hdr = (raw[headerIdx] as any[]).map((c: any) => String(c ?? "").toLowerCase());
        const idx = (key: string) => hdr.findIndex((h: string) => h.includes(key));

        const firstIdx  = idx("first");
        const lastIdx   = idx("last");
        const genderIdx = idx("gender");
        const phoneIdx  = idx("phone");
        const typeIdx   = idx("type");
        const groupIdx  = idx("group name");
        const sizeIdx   = idx("group size");

        const parsed: FarmerRow[] = [];
        for (let i = headerIdx + 1; i < raw.length; i++) {
          const r = raw[i] as any[];
          const firstName    = String(r[firstIdx] ?? "").trim();
          const lastName     = String(r[lastIdx]  ?? "").trim();
          const farmerGroup  = groupIdx >= 0 ? String(r[groupIdx] ?? "").trim() : "";
          if (!firstName && !farmerGroup) continue;

          const rawType = typeIdx >= 0 ? String(r[typeIdx] ?? "").toLowerCase().trim() : "";
          const beneficiaryType = rawType === "group" ? "group" : "individual";
          const groupSizeVal = sizeIdx >= 0 && r[sizeIdx] ? Number(r[sizeIdx]) : null;

          parsed.push({
            firstName,
            lastName,
            gender:        genderIdx >= 0 ? String(r[genderIdx] ?? "").trim() : "",
            phone:         phoneIdx  >= 0 ? String(r[phoneIdx]  ?? "").trim() : "",
            beneficiaryType,
            farmerGroup,
            groupSize: isNaN(groupSizeVal as number) ? null : groupSizeVal,
          });
        }

        if (parsed.length === 0) {
          toast({ title: "No data", description: "No valid rows were found in the file.", variant: "destructive" });
          return;
        }

        // Compute intra-file duplicates (client-side, no API needed)
        const phoneSeen = new Map<string, number>(); // phone → first 1-based row
        const intraMap = new Map<string, number>();
        parsed.forEach((r, i) => {
          if (!r.phone) return;
          if (phoneSeen.has(r.phone)) {
            // Mark this phone as a duplicate; store first occurrence row
            if (!intraMap.has(r.phone)) {
              intraMap.set(r.phone, phoneSeen.get(r.phone)!);
            }
          } else {
            phoneSeen.set(r.phone, i + 1);
          }
        });
        setIntraFileDupeMap(intraMap);

        setRows(parsed);
        setStep(2);

        const phones = parsed.map(r => r.phone).filter(Boolean);
        if (phones.length > 0) {
          setCheckingDuplicates(true);
          try {
            const dupes = await bulkCheckDuplicates(phones);
            const map = new Map<string, DuplicateInfo>();
            for (const d of dupes) {
              if (d.phone) map.set(d.phone, d);
            }
            setDuplicateMap(map);
          } catch {
            // non-fatal; advisory only
          } finally {
            setCheckingDuplicates(false);
          }
        }
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

  async function handleImport() {
    try {
      const result = await importMutation.mutateAsync({
        rows: rows.map(r => ({
          firstName:       r.firstName       || undefined,
          lastName:        r.lastName        || undefined,
          gender:          r.gender          || undefined,
          phone:           r.phone           || undefined,
          beneficiaryType: r.beneficiaryType || undefined,
          farmerGroup:     r.farmerGroup     || undefined,
          groupSize:       r.groupSize       ?? undefined,
        })),
        districtId:   districtId   ? Number(districtId)   : undefined,
        valueChainId: valueChainId ? Number(valueChainId) : undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.farmers() });
      setImportResult(result);
      setStep(3);
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
  }

  function printLabels(farmers: any[]) {
    const win = window.open("", "_blank");
    if (!win) {
      toast({ title: "Popup blocked", description: "Please allow popups to print labels.", variant: "destructive" });
      return;
    }
    const labelRows = farmers.map((f: any) => `
      <div class="label">
        <p class="name">${f.name}</p>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(f.barcodeToken)}" alt="QR" width="96" height="96" />
        <p class="code">${f.farmerCode}</p>
      </div>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><title>Farmer Labels</title>
      <style>
        body{font-family:sans-serif;margin:10px}
        h3{margin:0 0 10px;font-size:14px}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
        .label{border:1px solid #ccc;padding:10px;text-align:center;break-inside:avoid;border-radius:4px}
        .name{font-weight:bold;font-size:11px;margin:0 0 6px}
        .code{font-family:monospace;font-size:9px;color:#444;margin:6px 0 0}
        @media print{@page{margin:10mm}}
      </style></head>
      <body>
        <h3>Farmer Labels — ${farmers.length} farmers</h3>
        <div class="grid">${labelRows}</div>
      </body></html>`);
    setTimeout(() => win.print(), 700);
  }

  function downloadFlaggedRows() {
    const flagged = rows.filter(r => r.phone && duplicateMap.has(r.phone));
    const sheetData = [
      [...EXCEL_COLS, "Matched Farmer Code"],
      ...flagged.map(r => {
        const dupeInfo = duplicateMap.get(r.phone)!;
        return [
          r.firstName,
          r.lastName,
          r.gender,
          r.phone,
          r.beneficiaryType,
          r.farmerGroup,
          r.groupSize ?? "",
          dupeInfo.farmerCode,
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Flagged Rows");
    XLSX.writeFile(wb, "flagged-duplicate-rows.xlsx");
  }

  const groups  = rows.filter(r => r.beneficiaryType === "group").length;
  const indivs  = rows.length - groups;
  const dupeCount = duplicateMap.size;
  // Number of rows that share a phone with another row in the file (all rows with that phone, not just duplicates after first)
  const intraFileDupeRowCount = rows.filter(r => r.phone && intraFileDupeMap.has(r.phone)).length;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-5 pb-0">
          <DialogTitle className="text-lg">Bulk Farmer Registration</DialogTitle>
        </DialogHeader>

        {/* Step indicators */}
        <div className="flex items-center px-6 py-4 gap-0">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done   = n < step;
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

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Upload an Excel file with farmer details. Individual and group beneficiaries are both supported.
                Each row gets an auto-generated farmer code and barcode.
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
                onClick={() => document.getElementById("bulk-farmer-input")?.click()}
              >
                <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="font-semibold text-sm">Drop Excel file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .xlsx and .xls</p>
                <input id="bulk-farmer-input" type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
              </div>

              <div className="rounded-md bg-muted/60 p-3 space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Expected columns:</p>
                <p>First Name · Last Name · Gender · Phone · Type (individual/group) · Group Name · Group Size</p>
                <p>Leave "Group Name" blank for individuals. "Group Size" only applies to group rows.</p>
              </div>
            </div>
          )}

          {/* Step 2: Setup & Preview */}
          {step === 2 && (
            <div className="space-y-4 py-3">
              <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3">
                <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800">
                  <span className="font-semibold">{rows.length} farmers</span> parsed —{" "}
                  {indivs} individual{indivs !== 1 ? "s" : ""}, {groups} group{groups !== 1 ? "s" : ""}.
                  Choose a district and value chain to apply to all rows.
                </p>
              </div>

              {/* Duplicate warning banner */}
              {checkingDuplicates && (
                <div className="flex items-center gap-2 rounded-md bg-muted/60 border px-3 py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground">Checking for duplicate phone numbers…</p>
                </div>
              )}
              {intraFileDupeRowCount > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-800">
                    <span className="font-semibold">{intraFileDupeRowCount} row{intraFileDupeRowCount !== 1 ? "s" : ""}</span>{" "}
                    share a phone number with another row in this file (highlighted red below).
                    {" "}Only the first occurrence of each phone will be imported — remove the duplicates from your file to import all of them.
                  </p>
                </div>
              )}
              {!checkingDuplicates && dupeCount > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">{dupeCount} row{dupeCount !== 1 ? "s" : ""}</span>{" "}
                      {dupeCount !== 1 ? "have" : "has"} a phone number already in the system (highlighted amber below).
                      {" "}These will be skipped on import — fix your file or proceed to skip them.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100"
                      onClick={downloadFlaggedRows}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download flagged rows
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>District <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select value={districtId} onValueChange={setDistrictId}>
                    <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {districtList.map((d: any) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Value Chain <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select value={valueChainId} onValueChange={setValueChainId}>
                    <SelectTrigger><SelectValue placeholder="Select value chain" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {valueChainList.map((v: any) => (
                        <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border overflow-auto max-h-72">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name / Group</TableHead>
                      <TableHead className="text-xs">Gender</TableHead>
                      <TableHead className="text-xs">Phone</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs text-right">Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => {
                      const dbDupe   = r.phone ? duplicateMap.get(r.phone)     : undefined;
                      const intraFirstRow = r.phone ? intraFileDupeMap.get(r.phone) : undefined;
                      const isIntra  = intraFirstRow !== undefined;
                      const rowNum   = i + 1;
                      return (
                        <TableRow
                          key={i}
                          className={cn(
                            isIntra ? "bg-red-50 hover:bg-red-100" :
                            dbDupe  ? "bg-amber-50 hover:bg-amber-100" : undefined,
                          )}
                        >
                          <TableCell className="text-xs font-medium">
                            {r.beneficiaryType === "group"
                              ? (r.farmerGroup || "—")
                              : `${r.firstName} ${r.lastName}`.trim() || "—"
                            }
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.gender || "—"}</TableCell>
                          <TableCell className="text-xs font-mono">
                            <span className={cn(
                              isIntra ? "text-red-700 font-semibold" :
                              dbDupe  ? "text-amber-700 font-semibold" :
                                        "text-muted-foreground",
                            )}>
                              {r.phone || "—"}
                            </span>
                            {isIntra && (
                              <span className="ml-1.5 text-[10px] text-red-500 font-normal">
                                {intraFirstRow === rowNum
                                  ? "↳ also in this file"
                                  : `↳ same as row ${intraFirstRow}`}
                              </span>
                            )}
                            {!isIntra && dbDupe && (
                              <span className="ml-1.5 text-[10px] text-amber-600 font-normal">
                                ↳ {dbDupe.farmerCode}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={r.beneficiaryType === "group" ? "secondary" : "outline"} className="text-[10px]">
                              {r.beneficiaryType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                            {r.groupSize ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Step 3: Done */}
          {step === 3 && importResult && (
            <div className="py-6 flex flex-col items-center gap-5">
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle2 className="h-14 w-14 text-emerald-600" />
                <div>
                  <p className="text-lg font-semibold">Registration Complete</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">{importResult.created}</span> farmer{importResult.created !== 1 ? "s" : ""} registered
                    {importResult.duplicates?.length > 0 && (
                      <>, <span className="text-amber-600 font-medium">{importResult.duplicates.length} duplicate{importResult.duplicates.length !== 1 ? "s" : ""} skipped</span></>
                    )}
                    {importResult.skipped > 0 && (
                      <>, <span className="text-muted-foreground">{importResult.skipped} skipped</span> (missing name/group)</>
                    )}
                  </p>
                </div>
                {importResult.farmers.length > 0 && (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => printLabels(importResult.farmers)}
                  >
                    <Printer className="h-4 w-4" />
                    Print Barcode Labels ({importResult.farmers.length})
                  </Button>
                )}
              </div>

              {importResult.duplicates?.length > 0 && (
                <div className="w-full rounded-md border border-amber-200 bg-amber-50 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-200">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                    <p className="text-xs font-semibold text-amber-800">
                      {importResult.duplicates.length} row{importResult.duplicates.length !== 1 ? "s" : ""} skipped — duplicate phone number
                    </p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-amber-50/80">
                          <TableHead className="text-xs text-amber-800">Row</TableHead>
                          <TableHead className="text-xs text-amber-800">Name / Group</TableHead>
                          <TableHead className="text-xs text-amber-800">Phone</TableHead>
                          <TableHead className="text-xs text-amber-800">Conflict</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.duplicates.map((d) => {
                          const intraBatchRow = parseIntraBatchRow(d.matchedFarmerCode);
                          return (
                            <TableRow key={d.row} className="bg-white">
                              <TableCell className="text-xs text-muted-foreground">{d.row}</TableCell>
                              <TableCell className="text-xs font-medium">{d.name}</TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">{d.phone}</TableCell>
                              <TableCell className="text-xs">
                                {intraBatchRow !== null ? (
                                  <span className="italic text-muted-foreground">
                                    Duplicate of row {intraBatchRow} in this file
                                  </span>
                                ) : (
                                  <span className="font-mono text-amber-700 select-all cursor-default" title={d.matchedFarmerCode}>
                                    {d.matchedFarmerCode}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t flex gap-2">
          {step > 1 && step < 3 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="gap-1">
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step === 3 ? (
            <Button onClick={handleClose}>Close</Button>
          ) : step === 1 ? (
            <Button disabled>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending || rows.length === 0}
              className="gap-2 bg-green-700 hover:bg-green-800 text-white"
            >
              {importMutation.isPending ? "Importing…" : `Register ${rows.length} Farmers`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
