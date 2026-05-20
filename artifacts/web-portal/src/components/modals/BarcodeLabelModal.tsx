import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, AlertCircle, Tag } from "lucide-react";

export interface BarcodeLabelItem {
  name: string;
  itemCode: string;
  barcode: string;
  category?: string;
  unit?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: BarcodeLabelItem;
}

const LABEL_SIZES = [
  { id: "small",  label: "Small  (54 × 25 mm)", pageW: "54mm",  pageH: "25mm"  },
  { id: "medium", label: "Medium (72 × 36 mm)", pageW: "72mm",  pageH: "36mm"  },
  { id: "large",  label: "Large (100 × 50 mm)", pageW: "100mm", pageH: "50mm"  },
] as const;
type SizeId = (typeof LABEL_SIZES)[number]["id"];

const PREVIEW_W: Record<SizeId, number> = { small: 216, medium: 288, large: 360 };
const PREVIEW_H: Record<SizeId, number> = { small: 100, medium: 144, large: 180 };

const CAT_COLORS: Record<string, string> = {
  seed:       "#14532d",
  fertilizer: "#78350f",
  chemical:   "#4a044e",
  tool:       "#1e3a5f",
  equipment:  "#1e293b",
};
function catColor(cat?: string) {
  return CAT_COLORS[(cat ?? "").toLowerCase()] ?? "#1f2937";
}

export function BarcodeLabelModal({ open, onClose, item }: Props) {
  const canvasRef               = useRef<HTMLCanvasElement>(null);
  const [qty, setQty]           = useState("1");
  const [size, setSize]         = useState<SizeId>("medium");
  const [dataUrl, setDataUrl]   = useState<string>("");
  const [hasError, setHasError] = useState(false);

  const barcodeValue = item.barcode?.trim() || item.itemCode?.trim();

  useEffect(() => {
    if (!open) return;
    setHasError(false);
    if (!barcodeValue || !canvasRef.current) { setDataUrl(""); return; }
    try {
      JsBarcode(canvasRef.current, barcodeValue, {
        format:       "CODE128",
        width:        2.8,
        height:       64,
        displayValue: false,
        margin:       0,
        background:   "#ffffff",
        lineColor:    "#111827",
      });
      setDataUrl(canvasRef.current.toDataURL("image/png"));
    } catch {
      setHasError(true);
      setDataUrl("");
    }
  }, [open, barcodeValue]);

  function makeLabelHtml(sz: (typeof LABEL_SIZES)[number]) {
    const hdr = catColor(item.category);
    const barcodeBlock = dataUrl
      ? `<img src="${dataUrl}" class="bc-img" alt="barcode" />`
      : `<div class="bc-empty">No barcode</div>`;
    return `
<div class="label" style="width:${sz.pageW};height:${sz.pageH}">
  <div class="lbl-header" style="background:${hdr}">
    <span class="brand">INVENDIS</span>
    ${item.category ? `<span class="cat">${item.category}</span>` : ""}
  </div>
  <div class="lbl-body">
    <p class="item-name">${item.name}</p>
    <p class="item-meta">${item.itemCode}${item.unit ? ` &middot; ${item.unit}` : ""}</p>
    <div class="bc-wrap">${barcodeBlock}</div>
    <p class="bc-val">${barcodeValue}</p>
  </div>
</div>`;
  }

  function handlePrint() {
    const sz    = LABEL_SIZES.find(s => s.id === size)!;
    const count = Math.max(1, Math.min(100, Number(qty) || 1));
    const win   = window.open("", "_blank", "width=960,height=720");
    if (!win) return;

    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Barcode Labels — ${item.name}</title>
  <style>
    @page { size: ${sz.pageW} ${sz.pageH}; margin: 0; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f3f4f6;
      padding: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-content: flex-start;
    }
    @media print {
      body { background: white; padding: 0; gap: 0; }
    }

    .label {
      display: flex;
      flex-direction: column;
      background: white;
      border: 0.3mm solid #9ca3af;
      border-radius: 1.5mm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      box-shadow: 0 1px 4px rgba(0,0,0,.12);
    }
    @media print { .label { box-shadow: none; } }

    .lbl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1mm 2mm;
      flex-shrink: 0;
    }
    .brand {
      font-size: 2.8mm;
      font-weight: 800;
      color: white;
      letter-spacing: .1em;
      text-transform: uppercase;
    }
    .cat {
      font-size: 2.2mm;
      font-weight: 600;
      color: rgba(255,255,255,.85);
      background: rgba(255,255,255,.2);
      padding: .3mm 1.5mm;
      border-radius: 1mm;
      text-transform: capitalize;
    }

    .lbl-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1mm 2mm .8mm;
      gap: .5mm;
    }
    .item-name {
      font-size: 3.8mm;
      font-weight: 700;
      color: #111827;
      text-align: center;
      line-height: 1.2;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-meta {
      font-size: 2.5mm;
      color: #6b7280;
      font-family: 'Courier New', monospace;
    }
    .bc-wrap { width: 100%; display: flex; justify-content: center; }
    .bc-img  { width: 88%; height: auto; image-rendering: pixelated; display: block; }
    .bc-empty { font-size: 2.5mm; color: #9ca3af; font-style: italic; }
    .bc-val {
      font-family: 'Courier New', monospace;
      font-size: 2mm;
      color: #374151;
      letter-spacing: .04em;
    }
  </style>
</head>
<body>
${Array.from({ length: count }, () => makeLabelHtml(sz)).join("\n")}
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`);
    win.document.close();
  }

  if (!item) return null;

  const pw = PREVIEW_W[size];
  const ph = PREVIEW_H[size];
  const hdr = catColor(item.category);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Print Barcode Label
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ── Live label preview ── */}
          <div className="flex justify-center">
            <div
              className="border border-border rounded overflow-hidden shadow-sm flex flex-col"
              style={{ width: pw, height: ph }}
            >
              {/* Header strip */}
              <div
                className="flex items-center justify-between flex-shrink-0"
                style={{ background: hdr, padding: "4px 8px" }}
              >
                <span className="text-white font-black text-[10px] tracking-widest uppercase">INVENDIS</span>
                {item.category && (
                  <span className="text-white/80 text-[9px] font-semibold bg-white/20 rounded-full px-1.5 py-0.5 capitalize">
                    {item.category}
                  </span>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 flex flex-col items-center justify-center bg-white px-2 py-1 gap-0.5 overflow-hidden">
                <p className="font-bold text-gray-900 text-center text-[11px] leading-tight truncate max-w-full">
                  {item.name}
                </p>
                <p className="font-mono text-[9px] text-gray-500">
                  {item.itemCode}{item.unit ? ` · ${item.unit}` : ""}
                </p>

                {hasError ? (
                  <div className="flex items-center gap-1 text-destructive text-[9px]">
                    <AlertCircle className="h-3 w-3" /> Invalid barcode value
                  </div>
                ) : dataUrl ? (
                  <img src={dataUrl} alt="barcode" className="w-4/5 h-auto" style={{ imageRendering: "pixelated" }} />
                ) : (
                  <div className="text-[9px] text-muted-foreground italic">No barcode — using item code</div>
                )}

                {barcodeValue && !hasError && (
                  <p className="font-mono text-[8px] text-gray-400 truncate max-w-full">{barcodeValue}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Print options ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Label size</Label>
              <Select value={size} onValueChange={(v) => setSize(v as SizeId)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LABEL_SIZES.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Quantity</Label>
              <Select value={qty} onValueChange={setQty}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 5, 10, 20, 50, 100].map(n => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n} label{n > 1 ? "s" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasError && (
            <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
              The barcode value contains characters that can't be encoded in CODE128. Edit the item to fix it.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={hasError}
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print {qty} Label{Number(qty) > 1 ? "s" : ""}
            </Button>
          </div>
        </div>

        {/* Hidden canvas — JsBarcode renders here so we can toDataURL() for print */}
        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}
