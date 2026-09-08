import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Printer, Tag, AlertTriangle } from "lucide-react";
import { writePrintDocument } from "@/lib/utils";

/**
 * A label that goes on the item or pack a beneficiary receives, so whoever
 * hands it over can see who it belongs to without opening anything.
 *
 * One allocation, as returned by the allocations endpoint. `entitlements` is
 * what this beneficiary is owed once the campaign has been submitted; a Draft
 * campaign falls back to the package lines, which carry no per-beneficiary
 * quantity.
 */
export interface LabelAllocation {
  id: number;
  farmerName?: string | null;
  farmerCode?: string | null;
  beneficiaryType?: string | null;
  groupSize?: number | null;
  districtName?: string | null;
  campaignCode?: string | null;
  campaignName?: string | null;
  valueChainName?: string | null;
  barcodeToken?: string | null;
  entitlements?: {
    inputItemId: number;
    name: string | null;
    unit: string | null;
    quantityEntitled: number;
  }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  allocations: LabelAllocation[];
  /** Manifest code, when printing for a specific dispatch. */
  manifestCode?: string | null;
  /** Shown in the dialog so it is obvious what is about to come out. */
  contextLabel?: string;
}

// Big enough to read at arm's length on a stacked pallet. Sizes are the page
// box; the layout scales to fill whichever is chosen.
const SIZES = [
  { id: "a4quarter", label: 'A4 quarter — 4 per sheet (105 × 148 mm)', w: "105mm", h: "148mm", perRow: 2 },
  { id: "a6",        label: 'A6 — 2 per sheet (105 × 148 mm landscape)', w: "148mm", h: "105mm", perRow: 2 },
  { id: "large",     label: 'Thermal large (100 × 150 mm)',             w: "100mm", h: "150mm", perRow: 2 },
  { id: "medium",    label: 'Thermal medium (100 × 75 mm)',             w: "100mm", h: "75mm",  perRow: 2 },
] as const;
type SizeId = (typeof SIZES)[number]["id"];

type Mode = "per-item" | "per-beneficiary";

const BRAND = "AVDP";

function beneficiaryLine(a: LabelAllocation): string {
  const isGroup = (a.beneficiaryType ?? "").toLowerCase() === "group";
  if (isGroup && a.groupSize) return `Group of ${a.groupSize}`;
  return isGroup ? "Farmer group" : "Individual farmer";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** One printed label: either a single item line, or the whole package. */
interface LabelSpec {
  allocation: LabelAllocation;
  lines: { name: string; quantity: number; unit: string | null }[];
  /** Headline text — the item name, or the package summary. */
  heading: string;
  subheading: string;
}

function buildSpecs(allocations: LabelAllocation[], mode: Mode): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const a of allocations) {
    const lines = (a.entitlements ?? []).map((e) => ({
      name: e.name ?? "Item",
      quantity: e.quantityEntitled,
      unit: e.unit,
    }));
    if (!lines.length) continue;
    if (mode === "per-item") {
      for (const line of lines) {
        specs.push({
          allocation: a,
          lines: [line],
          heading: line.name,
          subheading: `${line.quantity}${line.unit ? ` ${line.unit}` : ""}`,
        });
      }
    } else {
      specs.push({
        allocation: a,
        lines,
        heading: a.farmerName ?? "Beneficiary",
        subheading: `${lines.length} item${lines.length === 1 ? "" : "s"} in this pack`,
      });
    }
  }
  return specs;
}

export function DistributionLabelModal({
  open, onClose, allocations, manifestCode, contextLabel,
}: Props) {
  const [mode, setMode] = useState<Mode>("per-item");
  const [size, setSize] = useState<SizeId>("a4quarter");
  const barcodeCache = useRef<Record<string, string>>({});
  const qrHost = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const specs = useMemo(() => buildSpecs(allocations, mode), [allocations, mode]);
  const withoutEntitlements = allocations.filter((a) => !(a.entitlements ?? []).length);

  // Barcodes are rasterised once per beneficiary and reused across their labels.
  useEffect(() => {
    if (!open) { setReady(false); return; }
    const cache: Record<string, string> = {};
    for (const a of allocations) {
      const value = (a.farmerCode ?? "").trim();
      if (!value || cache[value]) continue;
      try {
        const canvas = document.createElement("canvas");
        JsBarcode(canvas, value, {
          format: "CODE128", width: 3, height: 140,
          displayValue: false, margin: 0,
          background: "#ffffff", lineColor: "#000000",
        });
        cache[value] = canvas.toDataURL("image/png");
      } catch {
        /* a code that cannot be encoded simply prints without its barcode */
      }
    }
    barcodeCache.current = cache;
    setReady(true);
  }, [open, allocations]);

  function qrFor(token: string): string {
    const node = qrHost.current?.querySelector(`[data-qr="${CSS.escape(token)}"] svg`);
    return node?.outerHTML.replace(/\s+width="[^"]*"/, "").replace(/\s+height="[^"]*"/, "") ?? "";
  }

  function labelHtml(spec: LabelSpec, sz: (typeof SIZES)[number]): string {
    const a = spec.allocation;
    const token = (a.barcodeToken ?? a.farmerCode ?? "").trim();
    const barcode = barcodeCache.current[(a.farmerCode ?? "").trim()];
    const rows = spec.lines
      .map(
        (l) => `<tr><td class="it-name">${escapeHtml(l.name)}</td>
                    <td class="it-qty">${escapeHtml(l.quantity)}${l.unit ? ` <span class="it-unit">${escapeHtml(l.unit)}</span>` : ""}</td></tr>`,
      )
      .join("");

    return `
<div class="label" style="width:${sz.w};height:${sz.h}">
  <div class="hdr">
    <span class="brand">${BRAND}</span>
    <span class="chain">${escapeHtml(a.valueChainName ?? "—")}</span>
  </div>

  <div class="headline">
    <p class="h-main">${escapeHtml(spec.heading)}</p>
    <p class="h-sub">${escapeHtml(spec.subheading)}</p>
  </div>

  <div class="who">
    <p class="who-name">${escapeHtml(a.farmerName ?? "Beneficiary")}</p>
    <p class="who-meta">${escapeHtml(a.farmerCode ?? "")} &middot; ${escapeHtml(beneficiaryLine(a))}${a.districtName ? ` &middot; ${escapeHtml(a.districtName)}` : ""}</p>
  </div>

  <table class="items">${rows}</table>

  <div class="foot">
    <div class="codes">
      ${barcode ? `<img class="bc" src="${barcode}" alt="" />` : ""}
      <p class="bc-val">${escapeHtml(a.farmerCode ?? "")}</p>
      <p class="ids">
        <span>CAMPAIGN <b>${escapeHtml(a.campaignCode ?? "—")}</b></span>
        <span>DISPATCH <b>${escapeHtml(manifestCode ?? "—")}</b></span>
      </p>
    </div>
    <div class="qr">${token ? qrFor(token) : ""}</div>
  </div>
</div>`;
  }

  function handlePrint() {
    const sz = SIZES.find((s) => s.id === size)!;
    const win = window.open("", "_blank", "width=1000,height=800");
    if (!win) return;

    writePrintDocument(win, `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Distribution labels${manifestCode ? ` — ${escapeHtml(manifestCode)}` : ""}</title>
<style>
  @page { size: ${sz.w} ${sz.h}; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Arial, Helvetica, sans-serif; background: #e5e7eb; padding: 6mm; display: flex; flex-wrap: wrap; gap: 4mm; }
  @media print { body { background: #fff; padding: 0; gap: 0; } }

  .label { display: flex; flex-direction: column; background: #fff; border: 0.4mm solid #cbd5e1;
           page-break-inside: avoid; break-inside: avoid; overflow: hidden; }
  @media print { .label { border: none; } }

  .hdr { display: flex; align-items: center; justify-content: space-between;
         background: #14532d; color: #fff; padding: 2mm 4mm; flex-shrink: 0; }
  .brand { font-size: 5mm; font-weight: 900; letter-spacing: .08em; }
  .chain { font-size: 3.6mm; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
           max-width: 60%; text-align: right; line-height: 1.15; }

  /* The headline is what someone reads across a room. */
  .headline { padding: 3mm 4mm 1.5mm; border-bottom: 0.3mm dashed #cbd5e1; }
  .h-main { font-size: 8mm; font-weight: 900; line-height: 1.05; color: #0f172a;
            text-transform: uppercase; word-break: break-word; }
  .h-sub  { font-size: 6mm; font-weight: 800; color: #14532d; margin-top: 1mm; }

  .who { padding: 2.5mm 4mm 1.5mm; }
  .who-name { font-size: 6mm; font-weight: 800; color: #0f172a; line-height: 1.1; word-break: break-word; }
  .who-meta { font-size: 3.4mm; color: #475569; margin-top: 0.8mm; font-family: 'Courier New', monospace; }

  .items { width: calc(100% - 8mm); margin: 0 4mm; border-collapse: collapse; flex: 1; }
  .items td { border-top: 0.25mm solid #e2e8f0; padding: 1.2mm 0; vertical-align: top; }
  .it-name { font-size: 4mm; font-weight: 600; color: #1e293b; }
  .it-qty  { font-size: 4.6mm; font-weight: 900; color: #0f172a; text-align: right; white-space: nowrap; }
  .it-unit { font-size: 3.2mm; font-weight: 600; color: #64748b; }

  .foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 3mm;
          padding: 2mm 4mm 3mm; flex-shrink: 0; }
  .codes { flex: 1; min-width: 0; }
  .bc { width: 100%; height: 12mm; display: block; image-rendering: crisp-edges; }
  .bc-val { font-family: 'Courier New', monospace; font-size: 3.4mm; letter-spacing: .1em;
            color: #0f172a; font-weight: 700; margin-top: 0.5mm; }
  .ids { display: flex; gap: 4mm; margin-top: 1.2mm; font-size: 2.9mm; color: #64748b;
         letter-spacing: .05em; }
  .ids b { color: #0f172a; font-family: 'Courier New', monospace; font-size: 3.2mm; }
  .qr svg { width: 22mm !important; height: 22mm !important; display: block; }
</style>
</head>
<body>
${specs.map((spec) => labelHtml(spec, sz)).join("\n")}
</body>
</html>`);

    // writePrintDocument strips <script>, so the dialog is opened from here once
    // the barcode images have had a moment to decode.
    setTimeout(() => win.print(), 400);
  }

  const sz = SIZES.find((s) => s.id === size)!;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Print Distribution Labels
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {contextLabel && (
            <p className="text-xs text-muted-foreground">{contextLabel}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">One label per</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per-item">Item — sticks on each bag or box</SelectItem>
                  <SelectItem value="per-beneficiary">Beneficiary — one pack, all items listed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Label size</Label>
              <Select value={size} onValueChange={(v) => setSize(v as SizeId)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIZES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-semibold text-foreground">{specs.length}</span>{" "}
            label{specs.length === 1 ? "" : "s"} from{" "}
            <span className="font-semibold text-foreground">{allocations.length}</span>{" "}
            beneficiar{allocations.length === 1 ? "y" : "ies"}
            {manifestCode ? <> · dispatch <span className="font-mono">{manifestCode}</span></> : null}
          </div>

          {withoutEntitlements.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-800">
                {withoutEntitlements.length} beneficiar
                {withoutEntitlements.length === 1 ? "y has" : "ies have"} no entitlement lines yet and
                will be skipped. Submit the campaign so quantities are calculated, then print.
              </p>
            </div>
          )}

          {/* Rendered off-screen purely so the printable markup can be lifted. */}
          <div ref={qrHost} className="hidden">
            {allocations.map((a) => {
              const token = (a.barcodeToken ?? a.farmerCode ?? "").trim();
              if (!token) return null;
              return (
                <div key={a.id} data-qr={token}>
                  <QRCodeSVG
                    value={`${window.location.origin}/card/${encodeURIComponent(token)}`}
                    size={220}
                    level="M"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="bg-green-700 hover:bg-green-800 text-white"
            disabled={!ready || specs.length === 0}
            onClick={handlePrint}
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Print {specs.length || ""} label{specs.length === 1 ? "" : "s"} · {sz.w} × {sz.h}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
