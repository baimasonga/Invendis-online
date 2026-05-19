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
  photoUrl?: string | null;
}

export function FarmerIdCard({ farmer, photoUrl }: FarmerIdCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const qrValue = farmer.barcodeToken ?? farmer.farmerCode;

  function handlePrint() {
    const card = cardRef.current;
    if (!card) return;
    const win = window.open("", "_blank", "width=400,height=680");
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
          .card-body { padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
          .farmer-photo { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; border: 3px solid #16a34a; }
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
            ${photoUrl ? `<img src="${photoUrl}" class="farmer-photo" crossorigin="anonymous" />` : ""}
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

  async function handleDownload() {
    const W = 340;
    const fields: [string, string][] = [
      ...(farmer.gender       ? [["GENDER",      farmer.gender]      as [string,string]] : []),
      ...(farmer.districtName ? [["DISTRICT",    farmer.districtName] as [string,string]] : []),
      ...(farmer.chiefdomName ? [["CHIEFDOM",    farmer.chiefdomName] as [string,string]] : []),
      ...(farmer.valueChainName ? [["VALUE CHAIN", farmer.valueChainName] as [string,string]] : []),
      ...(farmer.phone        ? [["PHONE",        farmer.phone]       as [string,string]] : []),
      ...(farmer.status       ? [["STATUS",       farmer.status]      as [string,string]] : []),
    ];
    const infoRows = Math.ceil(fields.length / 2);
    const hasPhoto = !!photoUrl;
    const H = 60 + (hasPhoto ? 120 : 0) + 60 + 160 + 12 + infoRows * 38 + 50;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = "#15803d";
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(W - 12, 0);
    ctx.quadraticCurveTo(W, 0, W, 12); ctx.lineTo(W, 60);
    ctx.lineTo(0, 60); ctx.lineTo(0, 12);
    ctx.quadraticCurveTo(0, 0, 12, 0); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("INVENDIS — AGRI-POD", 16, 30);
    ctx.font = "10px sans-serif"; ctx.globalAlpha = 0.8;
    ctx.fillText("Farmer Identification Card", 16, 47);
    ctx.globalAlpha = 1;

    let y = 70;

    // Photo circle
    if (hasPhoto && photoUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); img.src = photoUrl; });
      if (img.naturalWidth > 0) {
        const cx = W / 2, cy = y + 50, r = 48;
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
        const aspect = img.naturalWidth / img.naturalHeight;
        const dw = aspect > 1 ? r * 2 * aspect : r * 2;
        const dh = aspect > 1 ? r * 2 : r * 2 / aspect;
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      y += 115;
    }

    // Name + code
    ctx.fillStyle = "#111827"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(`${farmer.firstName} ${farmer.lastName}`, W / 2, y + 20);
    ctx.font = "11px monospace"; ctx.fillStyle = "#6b7280";
    ctx.fillText(farmer.farmerCode, W / 2, y + 38);
    y += 55;

    // QR code
    const svgEl = cardRef.current?.querySelector("svg");
    if (svgEl) {
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const svgBase64 = btoa(unescape(encodeURIComponent(svgData)));
      const qrImg = new Image();
      await new Promise<void>(r => { qrImg.onload = () => r(); qrImg.onerror = () => r(); qrImg.src = `data:image/svg+xml;base64,${svgBase64}`; });
      const qrSize = 140, boxPad = 10, boxX = (W - qrSize - boxPad * 2) / 2;
      ctx.fillStyle = "#f8fafc"; ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(boxX, y, qrSize + boxPad * 2, qrSize + boxPad * 2); ctx.fill(); ctx.stroke();
      ctx.drawImage(qrImg, boxX + boxPad, y + boxPad, qrSize, qrSize);
      y += qrSize + boxPad * 2 + 14;
    }

    // Divider
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(W - 16, y); ctx.stroke();
    y += 12;

    // Info grid
    for (let i = 0; i < fields.length; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const x = col === 0 ? 16 : W / 2 + 8;
      const iy = y + row * 38;
      ctx.fillStyle = "#9ca3af"; ctx.font = "8px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(fields[i][0], x, iy + 10);
      ctx.fillStyle = "#374151"; ctx.font = "bold 11px sans-serif";
      ctx.fillText(fields[i][1], x, iy + 24);
    }
    y += infoRows * 38 + 8;

    // Footer
    ctx.fillStyle = "#f0fdf4"; ctx.fillRect(0, y, W, H - y);
    ctx.strokeStyle = "#bbf7d0"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = "#6b7280"; ctx.font = "9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Present this card at distribution points for identification", W / 2, y + 22);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${farmer.farmerCode}-id-card.png`; a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={handlePrint}>
          <Printer className="h-3 w-3 mr-1.5" /> Print ID Card
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={handleDownload}>
          <Download className="h-3 w-3 mr-1.5" /> Download Card
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
          {photoUrl && (
            <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-green-300 bg-gray-100 shrink-0">
              <img src={photoUrl} alt={`${farmer.firstName} ${farmer.lastName}`} className="w-full h-full object-cover" />
            </div>
          )}
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
