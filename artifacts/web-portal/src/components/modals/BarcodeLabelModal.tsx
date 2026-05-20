import { useEffect, useRef, useState, useCallback } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
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

const PREVIEW_W: Record<SizeId, number> = { small: 270, medium: 324, large: 400 };
const PREVIEW_H: Record<SizeId, number> = { small: 125, medium: 162, large: 200 };

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

const BRAND = "AVDP Farming Inputs";

export function BarcodeLabelModal({ open, onClose, item }: Props) {
  // Use a callback ref so the barcode renders the moment the canvas mounts
  // inside the Dialog portal — a plain useRef misses the first mount.
  const barcodeCanvasNode = useRef<HTMLCanvasElement | null>(null);
  const qrSourceRef       = useRef<HTMLDivElement>(null);

  const [qty, setQty]             = useState("1");
  const [size, setSize]           = useState<SizeId>("medium");
  const [bcDataUrl, setBcDataUrl] = useState<string>("");
  const [hasError, setHasError]   = useState(false);

  const barcodeValue = item.barcode?.trim() || item.itemCode?.trim();

  function renderBarcode(canvas: HTMLCanvasElement) {
    if (!barcodeValue) { setBcDataUrl(""); return; }
    setHasError(false);
    try {
      JsBarcode(canvas, barcodeValue, {
        format:       "CODE128",
        width:        2.8,
        height:       60,
        displayValue: false,
        margin:       0,
        background:   "#ffffff",
        lineColor:    "#111827",
      });
      setBcDataUrl(canvas.toDataURL("image/png"));
    } catch {
      setHasError(true);
      setBcDataUrl("");
    }
  }

  // Callback ref — fires immediately when the canvas enters the DOM
  const barcodeCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    barcodeCanvasNode.current = node;
    if (node && open) renderBarcode(node);
  }, [open, barcodeValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also re-render if barcodeValue changes while modal is already open
  useEffect(() => {
    if (!open) { setBcDataUrl(""); setHasError(false); return; }
    if (barcodeCanvasNode.current) renderBarcode(barcodeCanvasNode.current);
  }, [open, barcodeValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract QR SVG from hidden source div, strip fixed pixel dimensions
  function getQrSvgHtml(): string {
    const raw = qrSourceRef.current?.querySelector("svg")?.outerHTML ?? "";
    return raw
      .replace(/\s+width="[^"]*"/, "")
      .replace(/\s+height="[^"]*"/, "");
  }

  function makeLabelHtml(sz: (typeof LABEL_SIZES)[number]) {
    const hdr = catColor(item.category);
    const barcodeImg = bcDataUrl
      ? `<img src="${bcDataUrl}" class="bc-img" alt="barcode" />`
      : `<div class="bc-empty">No code</div>`;
    const qrSvg = getQrSvgHtml();

    return `
<div class="label" style="width:${sz.pageW};height:${sz.pageH}">
  <div class="lbl-header" style="background:${hdr}">
    <span class="brand">${BRAND}</span>
    ${item.category ? `<span class="cat">${item.category}</span>` : ""}
  </div>
  <div class="lbl-body">
    <div class="left-col">
      <p class="item-name">${item.name}</p>
      <p class="item-meta">${item.itemCode}${item.unit ? ` &middot; ${item.unit}` : ""}</p>
      <div class="bc-wrap">${barcodeImg}</div>
      <p class="bc-val">${barcodeValue}</p>
    </div>
    <div class="qr-col">
      <div class="qr-box">${qrSvg || `<div class="qr-placeholder">QR</div>`}</div>
      <p class="qr-label">Scan</p>
    </div>
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
  <title>Labels — ${item.name}</title>
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

    /* ── Label shell ── */
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

    /* ── Header ── */
    .lbl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1mm 2mm;
      flex-shrink: 0;
    }
    .brand {
      font-size: 2.6mm;
      font-weight: 800;
      color: white;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .cat {
      font-size: 2mm;
      font-weight: 600;
      color: rgba(255,255,255,.85);
      background: rgba(255,255,255,.2);
      padding: .3mm 1.5mm;
      border-radius: 1mm;
      text-transform: capitalize;
    }

    /* ── Body — two-column ── */
    .lbl-body {
      flex: 1;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      padding: 1mm 1.5mm .8mm;
      gap: 1.5mm;
    }

    /* Left: barcode column */
    .left-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: .4mm;
      min-width: 0;
    }
    .item-name {
      font-size: 3.4mm;
      font-weight: 700;
      color: #111827;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .item-meta {
      font-size: 2.2mm;
      color: #6b7280;
      font-family: 'Courier New', monospace;
    }
    .bc-wrap { width: 100%; }
    .bc-img  { width: 100%; height: auto; image-rendering: pixelated; display: block; }
    .bc-empty { font-size: 2.2mm; color: #9ca3af; font-style: italic; }
    .bc-val {
      font-family: 'Courier New', monospace;
      font-size: 1.9mm;
      color: #6b7280;
      letter-spacing: .04em;
    }

    /* Right: QR column */
    .qr-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: .5mm;
      flex-shrink: 0;
    }
    .qr-box {
      border: 0.3mm solid #e5e7eb;
      border-radius: 1mm;
      padding: 1mm;
      background: white;
      line-height: 0;
    }
    /* Force QR SVG to a scannable physical size */
    .qr-box svg {
      width: 14mm !important;
      height: 14mm !important;
      display: block;
    }
    .qr-placeholder {
      width: 14mm;
      height: 14mm;
      background: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3mm;
      color: #9ca3af;
    }
    .qr-label {
      font-size: 1.8mm;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: .05em;
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

  const pw  = PREVIEW_W[size];
  const ph  = PREVIEW_H[size];
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
              {/* Header */}
              <div
                className="flex items-center justify-between flex-shrink-0"
                style={{ background: hdr, padding: "4px 8px" }}
              >
                <span className="text-white font-black text-[10px] tracking-wide uppercase">{BRAND}</span>
                {item.category && (
                  <span className="text-white/80 text-[9px] font-semibold bg-white/20 rounded-full px-1.5 py-0.5 capitalize">
                    {item.category}
                  </span>
                )}
              </div>

              {/* Body — two columns */}
              <div className="flex-1 flex flex-row items-stretch bg-white px-2 py-1 gap-2 overflow-hidden">
                {/* Left: barcode info */}
                <div className="flex-1 flex flex-col justify-center gap-0.5 min-w-0">
                  <p className="font-bold text-gray-900 text-[11px] leading-tight truncate">
                    {item.name}
                  </p>
                  <p className="font-mono text-[9px] text-gray-500">
                    {item.itemCode}{item.unit ? ` · ${item.unit}` : ""}
                  </p>
                  {hasError ? (
                    <div className="flex items-center gap-1 text-destructive text-[9px]">
                      <AlertCircle className="h-3 w-3" /> Invalid value
                    </div>
                  ) : bcDataUrl ? (
                    <img src={bcDataUrl} alt="barcode" className="w-full h-auto" style={{ imageRendering: "pixelated" }} />
                  ) : (
                    <div className="text-[9px] text-muted-foreground italic">No barcode set</div>
                  )}
                  {barcodeValue && !hasError && (
                    <p className="font-mono text-[8px] text-gray-400 truncate">{barcodeValue}</p>
                  )}
                </div>

                {/* Right: QR code */}
                {barcodeValue && !hasError && (
                  <div className="flex flex-col items-center justify-center gap-0.5 flex-shrink-0">
                    <div className="border border-border rounded p-0.5 bg-white">
                      <QRCodeSVG
                        value={barcodeValue}
                        size={size === "small" ? 48 : size === "medium" ? 56 : 70}
                        level="H"
                        includeMargin={false}
                      />
                    </div>
                    <span className="text-[7px] text-gray-400 uppercase tracking-wider">Scan</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Print options ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Label size</Label>
              <Select value={size} onValueChange={(v) => setSize(v as SizeId)}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
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

        {/* Hidden CODE128 canvas — callback ref fires on mount so barcode renders immediately */}
        <canvas ref={barcodeCanvasRef} className="hidden" />

        {/* Hidden QR source — SVG outerHTML extracted for print template */}
        <div ref={qrSourceRef} className="hidden" aria-hidden>
          {barcodeValue && (
            <QRCodeSVG value={barcodeValue} size={300} level="H" includeMargin={false} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
