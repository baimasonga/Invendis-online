import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Tag } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  item: {
    name: string;
    itemCode: string;
    barcode: string;
    category?: string;
    unit?: string;
  };
}

export function BarcodeLabelModal({ open, onClose, item }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (open && svgRef.current && item.barcode) {
      try {
        JsBarcode(svgRef.current, item.barcode, {
          format: "CODE128",
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 13,
          margin: 10,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch {
        // invalid barcode value — ignore
      }
    }
  }, [open, item.barcode]);

  function handlePrint() {
    const printWin = window.open("", "_blank", "width=400,height=300");
    if (!printWin) return;
    const svg = svgRef.current?.outerHTML ?? "";
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Barcode Label — ${item.name}</title>
  <style>
    @page { size: 100mm 50mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; width: 100mm; height: 50mm; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4mm; background: #fff; }
    .label-title { font-size: 11pt; font-weight: bold; text-align: center; margin-bottom: 2mm; max-width: 90mm; }
    .label-meta { font-size: 7pt; color: #555; text-align: center; margin-bottom: 2mm; }
    svg { max-width: 88mm; }
  </style>
</head>
<body>
  <div class="label-title">${item.name}</div>
  <div class="label-meta">${item.itemCode}${item.category ? " · " + item.category : ""}${item.unit ? " · " + item.unit : ""}</div>
  ${svg}
  <script>window.onload = () => { window.print(); window.close(); }<\/script>
</body>
</html>`);
    printWin.document.close();
  }

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-4 w-4" /> Barcode Label Preview
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="border rounded-lg p-4 bg-white flex flex-col items-center gap-1 shadow-sm">
            <p className="font-bold text-sm text-center leading-tight">{item.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {item.itemCode}{item.category ? ` · ${item.category}` : ""}{item.unit ? ` · ${item.unit}` : ""}
            </p>
            {item.barcode ? (
              <svg ref={svgRef} className="mt-1 max-w-full" />
            ) : (
              <div className="h-16 flex items-center justify-center text-xs text-muted-foreground">
                No barcode set for this item
              </div>
            )}
          </div>

          {!item.barcode && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">
              This item has no barcode registered. Edit the item and assign a barcode first.
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Close</Button>
            <Button
              type="button"
              className="flex-1 bg-green-700 hover:bg-green-800 text-white"
              disabled={!item.barcode}
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Label
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
