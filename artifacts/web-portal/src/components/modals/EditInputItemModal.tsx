import { useState, useEffect, useRef } from "react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { updateInputItem, listValueChains, KEYS } from "@/lib/db";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { BarcodeLabelModal } from "@/components/modals/BarcodeLabelModal";
import { Camera, Printer, RefreshCw, ScanLine, X } from "lucide-react";

const CATEGORIES = ["Seed", "Fertilizer", "Chemical", "Tool", "Equipment", "Other"];

interface Props {
  open: boolean;
  onClose: () => void;
  item: any;
}

function generateBarcode(itemCode: string): string {
  // Format: INV + itemCode stripped of non-alphanum + random suffix, max 20 chars
  const base = ("INV" + (itemCode ?? "").replace(/[^A-Z0-9]/gi, "")).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return (base + suffix).slice(0, 20);
}

export function EditInputItemModal({ open, onClose, item }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: any }) => updateInputItem(id, payload) });

  const [name, setName]               = useState("");
  const [category, setCategory]       = useState("");
  const [unit, setUnit]               = useState("");
  const [valueChainId, setValueChainId] = useState("");
  const [barcode, setBarcode]         = useState("");

  const [scannerOpen, setScannerOpen] = useState(false);
  const [labelOpen, setLabelOpen]     = useState(false);

  const barcodeSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (item && open) {
      setName(item.name ?? "");
      setCategory(item.category ?? "");
      setUnit(item.unit ?? item.unitOfMeasure ?? "");
      setValueChainId(item.valueChainId ? String(item.valueChainId) : "");
      setBarcode(item.barcode ?? "");
    }
  }, [item, open]);

  const { data: valueChains } = useQuery({ queryKey: KEYS.valueChains(), queryFn: listValueChains });
  const valueChainList: any[] = Array.isArray(valueChains) ? valueChains : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    try {
      await updateMutation.mutateAsync({
        id: item.id,
        payload: {
          name,
          category: category || undefined,
          unit: unit || undefined,
          valueChainId: valueChainId && valueChainId !== "0" ? Number(valueChainId) : undefined,
          barcode: barcode.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: KEYS.inventory() });
      toast({ title: "Item updated", description: `"${name}" updated successfully.` });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  const labelItem = {
    name,
    itemCode: item?.itemCode ?? item?.code ?? "",
    barcode,
    category,
    unit,
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Input Item</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-1">

            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="kg, bags, litres…" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Value Chain</Label>
              <Select value={valueChainId} onValueChange={setValueChainId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">— None —</SelectItem>
                  {valueChainList.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── Barcode field ── */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5" /> Barcode
              </Label>
              <div className="flex gap-1.5">
                <Input
                  className="font-mono flex-1"
                  placeholder="Scan, type, or generate…"
                  value={barcode}
                  onChange={e => setBarcode(e.target.value)}
                />
                {barcode && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground shrink-0" title="Clear barcode" onClick={() => setBarcode("")}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                {barcodeSupported && (
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Scan barcode" onClick={() => setScannerOpen(true)}>
                    <Camera className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="Generate barcode"
                  onClick={() => setBarcode(generateBarcode(item?.itemCode ?? ""))}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Scan your printed label, type the number, or click <span className="font-medium">↻</span> to auto-generate one.
              </p>
            </div>

            <DialogFooter className="pt-2 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mr-auto"
                disabled={!barcode}
                onClick={() => setLabelOpen(true)}
              >
                <Printer className="h-3.5 w-3.5 mr-1" /> Print Label
              </Button>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="bg-green-700 hover:bg-green-800 text-white" disabled={updateMutation.isPending || !name}>
                {updateMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <BarcodeScannerDialog
        open={scannerOpen}
        title="Scan Barcode for Item"
        onDetected={(code) => { setScannerOpen(false); setBarcode(code); }}
        onClose={() => setScannerOpen(false)}
      />

      <BarcodeLabelModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        item={labelItem}
      />
    </>
  );
}
