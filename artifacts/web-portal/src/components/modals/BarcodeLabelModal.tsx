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
  { id: "thermal4x5", label: '5.5" × 7.5" Thermal Transfer', pageW: "5.5in", pageH: "7.5in" },
  { id: "large",      label: "Large  (100 × 50 mm)",          pageW: "100mm", pageH: "50mm"  },
  { id: "medium",     label: "Medium  (72 × 36 mm)",          pageW: "72mm",  pageH: "36mm"  },
  { id: "small",      label: "Small   (54 × 25 mm)",          pageW: "54mm",  pageH: "25mm"  },
] as const;
type SizeId = (typeof LABEL_SIZES)[number]["id"];

// Preview pixel dimensions (in dialog) — 5.5×7.5 ratio for thermal
const PREVIEW_W: Record<SizeId, number> = { thermal4x5: 330, large: 400, medium: 324, small: 270 };
const PREVIEW_H: Record<SizeId, number> = { thermal4x5: 450, large: 200, medium: 162, small: 125 };

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

// ── Barcode canvas scale ──────────────────────────────────────────────────────
// We render at 3× pixel density so the exported PNG is crisp at 200–300 dpi.
const BC_SCALE = 3;

export function BarcodeLabelModal({ open, onClose, item }: Props) {
  const barcodeCanvasNode = useRef<HTMLCanvasElement | null>(null);
  const qrSourceRef       = useRef<HTMLDivElement>(null);

  const [qty, setQty]             = useState("1");
  const [size, setSize]           = useState<SizeId>("thermal4x5");
  const [bcDataUrl, setBcDataUrl] = useState<string>("");
  const [hasError, setHasError]   = useState(false);

  const barcodeValue = item.barcode?.trim() || item.itemCode?.trim();
  const isThermal    = size === "thermal4x5";

  function renderBarcode(canvas: HTMLCanvasElement) {
    if (!barcodeValue) { setBcDataUrl(""); return; }
    setHasError(false);
    try {
      // Render at BC_SCALE × nominal bar width/height for high-res export
      JsBarcode(canvas, barcodeValue, {
        format:       "CODE128",
        width:        isThermal ? 3.5 * BC_SCALE : 2.8,
        height:       isThermal ? 110 * BC_SCALE : 60,
        displayValue: false,
        margin:       0,
        background:   "#ffffff",
        lineColor:    "#000000",
      });
      setBcDataUrl(canvas.toDataURL("image/png"));
    } catch {
      setHasError(true);
      setBcDataUrl("");
    }
  }

  const barcodeCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    barcodeCanvasNode.current = node;
    if (node && open) renderBarcode(node);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, barcodeValue, size]);

  useEffect(() => {
    if (!open) { setBcDataUrl(""); setHasError(false); return; }
    if (barcodeCanvasNode.current) renderBarcode(barcodeCanvasNode.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, barcodeValue, size]);

  function getQrSvgHtml(): string {
    const raw = qrSourceRef.current?.querySelector("svg")?.outerHTML ?? "";
    return raw
      .replace(/\s+width="[^"]*"/, "")
      .replace(/\s+height="[^"]*"/, "");
  }

  // ── Print HTML ───────────────────────────────────────────────────────────────
  function makeLabelHtml(sz: (typeof LABEL_SIZES)[number]) {
    const hdr       = catColor(item.category);
    const barcodeImg = bcDataUrl
      ? `<img src="${bcDataUrl}" class="bc-img" alt="barcode" />`
      : `<div class="bc-empty">No code</div>`;
    const qrSvg = getQrSvgHtml();
    const thermal = sz.id === "thermal4x5";

    return `
<div class="label" style="width:${sz.pageW};height:${sz.pageH}">
  <div class="lbl-header" style="background:${hdr}">
    <span class="brand">${BRAND}</span>
    ${item.category ? `<span class="cat">${item.category}</span>` : ""}
  </div>
  <div class="lbl-body${thermal ? " lbl-body--thermal" : ""}">
    <div class="left-col">
      <p class="item-name">${item.name}</p>
      <p class="item-meta">${item.itemCode}${item.unit ? ` &middot; ${item.unit}` : ""}</p>
      <div class="bc-wrap">${barcodeImg}</div>
      <p class="bc-val">${barcodeValue}</p>
      ${thermal ? `<p class="invendis-tag">Powered by Invendis</p>` : ""}
    </div>
    <div class="qr-col">
      <div class="qr-box">${qrSvg || `<div class="qr-placeholder">QR</div>`}</div>
      <p class="qr-label">Scan to verify</p>
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
  <title>Labels — ${item.name} (${item.itemCode})</title>
  <style>
    @page {
      size: ${sz.pageW} ${sz.pageH};
      margin: 0;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      -webkit-font-smoothing: antialiased;
      background: #e5e7eb;
      padding: 8px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-content: flex-start;
    }
    @media print {
      body {
        background: white;
        padding: 0;
        gap: 0;
      }
    }

    /* ── Print quality ── */
    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Label shell ── */
    .label {
      display: flex;
      flex-direction: column;
      background: white;
      border: 0.4mm solid #d1d5db;
      border-radius: 2mm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      box-shadow: 0 2px 8px rgba(0,0,0,.15);
    }
    @media print {
      .label {
        box-shadow: none;
        border-radius: 0;
      }
    }

    /* ── Header ── */
    .lbl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2.2mm 3.5mm;
      flex-shrink: 0;
    }
    .brand {
      font-size: 4.5mm;
      font-weight: 900;
      color: white;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .cat {
      font-size: 3.2mm;
      font-weight: 700;
      color: rgba(255,255,255,.9);
      background: rgba(255,255,255,.22);
      padding: .6mm 2.2mm;
      border-radius: 1.5mm;
      text-transform: capitalize;
      letter-spacing: .03em;
    }

    /* ── Body ── */
    .lbl-body {
      flex: 1;
      display: flex;
      flex-direction: row;
      align-items: stretch;
      padding: 2mm 3mm 2mm;
      gap: 3mm;
    }
    /* Thermal-specific — taller, more generous spacing */
    .lbl-body--thermal {
      padding: 4mm 5mm 4mm;
      gap: 5mm;
    }

    /* Left column */
    .left-col {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 1.2mm;
      min-width: 0;
    }
    .lbl-body--thermal .left-col {
      gap: 2.5mm;
    }

    .item-name {
      font-size: 5.5mm;
      font-weight: 800;
      color: #111827;
      line-height: 1.2;
      white-space: normal;
      word-break: break-word;
    }
    .item-meta {
      font-size: 3.2mm;
      color: #4b5563;
      font-family: 'Courier New', 'Courier', monospace;
      letter-spacing: .03em;
    }

    /* Barcode */
    .bc-wrap { width: 100%; }
    .bc-img {
      width: 100%;
      height: auto;
      display: block;
      /* crisp-edges keeps bar edges sharp without blurring */
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .bc-empty { font-size: 3mm; color: #9ca3af; font-style: italic; }
    .bc-val {
      font-family: 'Courier New', 'Courier', monospace;
      font-size: 3mm;
      color: #374151;
      letter-spacing: .08em;
    }
    .invendis-tag {
      font-size: 2.4mm;
      color: #9ca3af;
      letter-spacing: .04em;
      margin-top: 1mm;
    }

    /* QR column */
    .qr-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.5mm;
      flex-shrink: 0;
    }
    .qr-box {
      border: 0.4mm solid #d1d5db;
      border-radius: 1.5mm;
      padding: 1.5mm;
      background: white;
      line-height: 0;
    }
    /* Thermal: 40mm QR, others: 18mm */
    .lbl-body--thermal .qr-box svg {
      width: 40mm !important;
      height: 40mm !important;
      display: block;
      image-rendering: crisp-edges;
    }
    .qr-box svg {
      width: 18mm !important;
      height: 18mm !important;
      display: block;
      image-rendering: crisp-edges;
    }
    .qr-placeholder {
      width: 18mm;
      height: 18mm;
      background: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3mm;
      color: #9ca3af;
    }
    .lbl-body--thermal .qr-placeholder {
      width: 40mm;
      height: 40mm;
    }
    .qr-label {
      font-size: 2.6mm;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: .08em;
      font-weight: 600;
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Print Barcode Label
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">

          {/* ── Live label preview ── */}
          <div className="flex justify-center">
            <div
              className="border border-border rounded overflow-hidden shadow flex flex-col bg-white"
              style={{ width: pw, height: ph, maxHeight: 450 }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between flex-shrink-0"
                style={{ background: hdr, padding: isThermal ? "6px 12px" : "4px 8px" }}
              >
                <span
                  className="text-white font-black tracking-wide uppercase"
                  style={{ fontSize: isThermal ? 13 : 10 }}
                >
                  {BRAND}
                </span>
                {item.category && (
                  <span
                    className="text-white/90 font-bold bg-white/20 rounded-full capitalize"
                    style={{ fontSize: isThermal ? 11 : 9, padding: isThermal ? "2px 6px" : "1px 5px" }}
                  >
                    {item.category}
                  </span>
                )}
              </div>

              {/* Body — two columns */}
              <div
                className="flex-1 flex flex-row items-stretch bg-white overflow-hidden"
                style={{ padding: isThermal ? "12px 14px" : "4px 8px", gap: isThermal ? 12 : 6 }}
              >
                {/* Left: barcode info */}
                <div className="flex-1 flex flex-col justify-center min-w-0" style={{ gap: isThermal ? 6 : 2 }}>
                  <p
                    className="font-extrabold text-gray-900 leading-tight"
                    style={{ fontSize: isThermal ? 15 : 11 }}
                  >
                    {item.name}
                  </p>
                  <p
                    className="font-mono text-gray-500"
                    style={{ fontSize: isThermal ? 11 : 9 }}
                  >
                    {item.itemCode}{item.unit ? ` · ${item.unit}` : ""}
                  </p>
                  {hasError ? (
                    <div className="flex items-center gap-1 text-destructive text-[9px]">
                      <AlertCircle className="h-3 w-3" /> Invalid value
                    </div>
                  ) : bcDataUrl ? (
                    <img
                      src={bcDataUrl}
                      alt="barcode"
                      className="w-full h-auto block"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <div className="text-[9px] text-muted-foreground italic">No barcode set</div>
                  )}
                  {barcodeValue && !hasError && (
                    <p
                      className="font-mono text-gray-500 truncate"
                      style={{ fontSize: isThermal ? 10 : 8, letterSpacing: "0.06em" }}
                    >
                      {barcodeValue}
                    </p>
                  )}
                  {isThermal && (
                    <p className="text-[9px] text-gray-400 mt-1">Powered by Invendis</p>
                  )}
                </div>

                {/* Right: QR code */}
                {barcodeValue && !hasError && (
                  <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0">
                    <div className="border border-border rounded p-1 bg-white">
                      <QRCodeSVG
                        value={barcodeValue}
                        size={isThermal ? 100 : size === "large" ? 70 : size === "medium" ? 56 : 48}
                        level="H"
                        includeMargin={false}
                      />
                    </div>
                    <span
                      className="text-gray-400 uppercase tracking-wider"
                      style={{ fontSize: isThermal ? 9 : 7 }}
                    >
                      Scan to verify
                    </span>
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

        {/* Hidden high-res barcode canvas */}
        <canvas ref={barcodeCanvasRef} className="hidden" />

        {/* Hidden high-res QR source (300px → crisp SVG) */}
        <div ref={qrSourceRef} className="hidden" aria-hidden>
          {barcodeValue && (
            <QRCodeSVG value={barcodeValue} size={600} level="H" includeMargin={false} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
