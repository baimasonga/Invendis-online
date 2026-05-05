import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";

interface FarmerIdCardProps {
  farmer: {
    firstName: string;
    lastName: string;
    farmerCode: string;
    barcodeToken?: string | null;
    gender?: string | null;
    districtName?: string | null;
    chiefdomName?: string | null;
    valueChainName?: string | null;
    status?: string;
    phone?: string | null;
  };
}

export function FarmerIdCard({ farmer }: FarmerIdCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const qrValue = farmer.barcodeToken ?? farmer.farmerCode;

  function handlePrint() {
    const card = cardRef.current;
    if (!card) return;
    const html = card.innerHTML;
    const win = window.open("", "_blank", "width=400,height=640");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Farmer ID — ${farmer.farmerCode}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: system-ui, sans-serif; background: white; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { width: 340px; border: 2px solid #16a34a; border-radius: 12px; overflow: hidden; background: white; }
          .card-header { background: #15803d; padding: 16px; color: white; }
          .card-header h1 { font-size: 15px; font-weight: 700; letter-spacing: 0.05em; }
          .card-header p { font-size: 10px; opacity: 0.8; margin-top: 2px; }
          .card-body { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
          .farmer-name { font-size: 18px; font-weight: 700; color: #111; text-align: center; }
          .farmer-code { font-family: monospace; font-size: 12px; color: #6b7280; margin-top: 2px; }
          .qr-wrap { padding: 10px; border: 1.5px solid #e5e7eb; border-radius: 8px; }
          .info-grid { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1px solid #e5e7eb; padding-top: 14px; }
          .info-item label { font-size: 9px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
          .info-item p { font-size: 11px; font-weight: 600; color: #374151; margin-top: 1px; }
          .card-footer { background: #f0fdf4; padding: 8px 16px; text-align: center; }
          .card-footer p { font-size: 9px; color: #6b7280; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="card-header">
            <h1>INVENDIS — AGRI-POD</h1>
            <p>Farmer Identification Card</p>
          </div>
          <div class="card-body">
            <div style="text-align:center">
              <div class="farmer-name">${farmer.firstName} ${farmer.lastName}</div>
              <div class="farmer-code">${farmer.farmerCode}</div>
            </div>
            <div class="qr-wrap">
              ${card.querySelector("svg")?.outerHTML ?? ""}
            </div>
            <div class="info-grid">
              ${farmer.gender ? `<div class="info-item"><label>Gender</label><p>${farmer.gender}</p></div>` : ""}
              ${farmer.districtName ? `<div class="info-item"><label>District</label><p>${farmer.districtName}</p></div>` : ""}
              ${farmer.chiefdomName ? `<div class="info-item"><label>Chiefdom</label><p>${farmer.chiefdomName}</p></div>` : ""}
              ${farmer.valueChainName ? `<div class="info-item"><label>Value Chain</label><p>${farmer.valueChainName}</p></div>` : ""}
              ${farmer.phone ? `<div class="info-item"><label>Phone</label><p>${farmer.phone}</p></div>` : ""}
              <div class="info-item"><label>Status</label><p style="color:${farmer.status === 'approved' ? '#16a34a' : '#f59e0b'}">${farmer.status ?? '—'}</p></div>
            </div>
          </div>
          <div class="card-footer">
            <p>Present this card at distribution points for identification</p>
          </div>
        </div>
        <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
  }

  function handleDownload() {
    const svg = cardRef.current?.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${farmer.farmerCode}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={handlePrint}>
          <Printer className="h-3 w-3 mr-1.5" /> Print ID Card
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={handleDownload}>
          <Download className="h-3 w-3 mr-1.5" /> Download QR
        </Button>
      </div>

      {/* Hidden render source for QR extraction */}
      <div ref={cardRef} className="hidden">
        <QRCodeSVG
          value={qrValue}
          size={140}
          level="M"
          includeMargin={false}
          style={{ display: "block" }}
        />
      </div>

      {/* Visual preview */}
      <div className="border rounded-lg overflow-hidden shadow-sm">
        {/* Header */}
        <div className="bg-green-700 px-4 py-3 text-white">
          <p className="text-xs font-bold tracking-wider uppercase">Invendis — Agri-PoD</p>
          <p className="text-[10px] opacity-70 mt-0.5">Farmer Identification Card</p>
        </div>

        {/* Body */}
        <div className="bg-white p-4 flex flex-col items-center gap-3">
          <div className="text-center">
            <p className="font-bold text-base leading-tight">{farmer.firstName} {farmer.lastName}</p>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">{farmer.farmerCode}</p>
          </div>

          <div className="p-2 border border-slate-200 rounded-lg bg-white">
            <QRCodeSVG
              value={qrValue}
              size={130}
              level="M"
              includeMargin={false}
            />
          </div>

          <div className="w-full grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            {farmer.gender && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Gender</p>
                <p className="text-xs font-semibold mt-0.5">{farmer.gender}</p>
              </div>
            )}
            {farmer.districtName && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">District</p>
                <p className="text-xs font-semibold mt-0.5">{farmer.districtName}</p>
              </div>
            )}
            {farmer.valueChainName && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Value Chain</p>
                <p className="text-xs font-semibold mt-0.5">{farmer.valueChainName}</p>
              </div>
            )}
            {farmer.status && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Status</p>
                <p className={`text-xs font-semibold mt-0.5 capitalize ${farmer.status === "approved" ? "text-emerald-700" : "text-amber-700"}`}>
                  {farmer.status}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-green-50 border-t border-green-100 px-4 py-2 text-center">
          <p className="text-[9px] text-muted-foreground">Present this card at distribution points for identification</p>
        </div>
      </div>
    </div>
  );
}
