import { useRef, useState } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { receiveStock, listWarehouses, listInputItems, KEYS } from "@/lib/db";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { Camera, CheckCircle2, ScanLine, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ReceiveStockModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const receive = useMutation({ mutationFn: receiveStock });

  const [warehouseId, setWarehouseId] = useState("");
  const [inputItemId, setInputItemId] = useState("");
  const [quantity, setQuantity]       = useState("");
  const [reference, setReference]     = useState("");
  const [notes, setNotes]             = useState("");

  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeMatch, setBarcodeMatch] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen]   = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const { data: warehouses } = useQuery({ queryKey: KEYS.warehouses(), queryFn: listWarehouses });
  const { data: inputItems } = useQuery({ queryKey: KEYS.inventory(),  queryFn: listInputItems });

  const warehouseList: any[] = Array.isArray(warehouses) ? warehouses : [];
  const itemList: any[]      = Array.isArray(inputItems)  ? inputItems  : [];

  const barcodeSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  function resetForm() {
    setWarehouseId(""); setInputItemId(""); setQuantity("");
    setReference(""); setNotes("");
    setBarcodeInput(""); setBarcodeMatch(null); setBarcodeError(null);
  }

  function handleBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBarcodeInput("");

    // Match against registered barcode first, then item code, then name
    const item = itemList.find(
      (i: any) =>
        (i.barcode && i.barcode.toLowerCase() === trimmed.toLowerCase()) ||
        i.itemCode?.toLowerCase() === trimmed.toLowerCase() ||
        i.name?.toLowerCase() === trimmed.toLowerCase()
    );

    if (item) {
      setInputItemId(String(item.id));
      setBarcodeMatch(item.name);
      setBarcodeError(null);
      // focus quantity after auto-selecting item
      setTimeout(() => document.getElementById("rs-qty")?.focus(), 50);
    } else {
      // no item match — treat as reference / PO number
      setReference(trimmed);
      setBarcodeMatch(null);
      setBarcodeError(`No item matched "${trimmed}" — filled in Reference field. Register this barcode on an item first.`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!warehouseId || !inputItemId || !quantity) return;
    try {
      await receive.mutateAsync({
        warehouseId: Number(warehouseId),
        inputItemId: Number(inputItemId),
        quantity: Number(quantity),
        reference: reference || undefined,
        notes: notes || undefined,
      });
      await qc.invalidateQueries({ queryKey: KEYS.stockBalance() });
      toast({ title: "Stock received", description: `${quantity} units added to warehouse.` });
      resetForm();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to receive stock", description: err.message, variant: "destructive" });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Receive Stock</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-1">

            {/* ── Barcode scan strip ── */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5" /> Scan Item Barcode
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    ref={barcodeRef}
                    className="font-mono pr-8"
                    placeholder="Scan or type item code — press Enter"
                    value={barcodeInput}
                    onChange={e => { setBarcodeInput(e.target.value); setBarcodeMatch(null); setBarcodeError(null); }}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleBarcode(barcodeInput); } }}
                  />
                  {barcodeInput && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => { setBarcodeInput(""); setBarcodeMatch(null); setBarcodeError(null); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {barcodeSupported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Scan with webcam"
                    onClick={() => setScannerOpen(true)}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {barcodeMatch && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Matched: <span className="font-medium">{barcodeMatch}</span>
                </p>
              )}
              {barcodeError && (
                <p className="text-xs text-amber-600">{barcodeError}</p>
              )}
            </div>

            <div className="border-t" />

            {/* ── Warehouse ── */}
            <div className="space-y-1.5">
              <Label>Warehouse *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Select warehouse…" /></SelectTrigger>
                <SelectContent>
                  {warehouseList.map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── Input Item (auto-selected on scan) ── */}
            <div className="space-y-1.5">
              <Label>Input Item *</Label>
              <Select value={inputItemId} onValueChange={v => { setInputItemId(v); setBarcodeMatch(null); }}>
                <SelectTrigger
                  className={barcodeMatch ? "border-emerald-500 ring-1 ring-emerald-400" : ""}
                >
                  <SelectValue placeholder="Select item… or scan barcode above" />
                </SelectTrigger>
                <SelectContent>
                  {itemList.map((item: any) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name}{" "}
                      <span className="text-muted-foreground">
                        ({item.itemCode ?? item.unitOfMeasure ?? item.unit})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rs-qty">Quantity *</Label>
                <Input
                  id="rs-qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="0"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rs-ref">Reference / PO#</Label>
                <Input
                  id="rs-ref"
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="PO-2026-001"
                  className={barcodeError ? "border-amber-400" : ""}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rs-notes">Notes</Label>
              <Input
                id="rs-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional delivery notes…"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
              <Button
                type="submit"
                className="bg-green-700 hover:bg-green-800 text-white"
                disabled={receive.isPending}
              >
                {receive.isPending ? "Saving…" : "Receive Stock"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <BarcodeScannerDialog
        open={scannerOpen}
        title="Scan Item Barcode"
        onDetected={(code) => { setScannerOpen(false); handleBarcode(code); }}
        onClose={() => setScannerOpen(false)}
      />
    </>
  );
}
