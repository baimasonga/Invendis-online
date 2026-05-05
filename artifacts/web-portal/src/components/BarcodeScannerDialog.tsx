import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, CameraOff, Keyboard } from "lucide-react";

interface Props {
  open: boolean;
  title?: string;
  onDetected: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScannerDialog({ open, title = "Scan Barcode", onDetected, onClose }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [camError, setCamError]   = useState<string | null>(null);
  const [manualVal, setManualVal] = useState("");
  const [inputMode, setInputMode] = useState(false);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!open) { stopCamera(); return; }
    if (!supported) { setInputMode(true); return; }
    startCamera();
    return stopCamera;
  }, [open]);

  async function startCamera() {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // @ts-ignore — BarcodeDetector is a web platform API, not in TS lib yet
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix"],
      });
      intervalRef.current = setInterval(detectFrame, 350);
    } catch {
      setCamError("Camera unavailable — enter the code manually below.");
      setInputMode(true);
    }
  }

  async function detectFrame() {
    if (!videoRef.current || !detectorRef.current) return;
    try {
      const results: any[] = await detectorRef.current.detect(videoRef.current);
      if (results.length > 0) {
        stopCamera();
        onDetected(results[0].rawValue);
      }
    } catch { /* ignore intermittent detection errors */ }
  }

  function stopCamera() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function handleManual() {
    const v = manualVal.trim();
    if (!v) return;
    setManualVal("");
    stopCamera();
    onDetected(v);
  }

  function handleClose() {
    stopCamera();
    setManualVal("");
    setCamError(null);
    setInputMode(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" /> {title}
          </DialogTitle>
        </DialogHeader>

        {!inputMode && supported ? (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
              {!camError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-44 h-44 border-2 border-primary rounded-lg" />
                  <div className="absolute bottom-3 left-0 right-0 text-center">
                    <span className="text-xs text-white bg-black/60 px-2 py-1 rounded">
                      Point camera at barcode or QR code
                    </span>
                  </div>
                </div>
              )}
              {camError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white bg-black/70 p-4">
                  <CameraOff className="h-8 w-8 opacity-60" />
                  <p className="text-sm text-center opacity-80">{camError}</p>
                </div>
              )}
            </div>
            <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setInputMode(true)}>
              <Keyboard className="h-3.5 w-3.5 mr-1.5" /> Type code manually
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {!supported && (
              <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                Camera barcode detection is not available in this browser. Connect a USB/Bluetooth scanner or type the code below.
              </p>
            )}
            <Input
              autoFocus
              placeholder="Scan or type barcode…"
              className="font-mono"
              value={manualVal}
              onChange={e => setManualVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleManual()}
            />
            <div className="flex gap-2">
              {supported && (
                <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => { setInputMode(false); startCamera(); }}>
                  Use Camera
                </Button>
              )}
              <Button type="button" size="sm" className="flex-1 bg-green-700 hover:bg-green-800 text-white" onClick={handleManual}>
                Confirm
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
