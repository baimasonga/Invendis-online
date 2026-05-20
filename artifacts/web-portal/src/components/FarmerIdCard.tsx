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
    const win = window.open("", "_blank", "width=500,height=820");
    if (!win) return;
    const photoBlock = photoUrl
      ? `<img src="${photoUrl}" class="farmer-photo" crossorigin="anonymous" />`
      : `<div class="farmer-photo placeholder">
           <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
             <circle cx="12" cy="8" r="4"/>
             <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
           </svg>
         </div>`;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>AVDP Farmer ID — ${farmer.farmerCode}</title>
        <style>
          @page { size: 100mm 160mm; margin: 0; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { background: white; }
          body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 8mm; }
          .card { width: 100mm; height: 160mm; border: 2px solid #16a34a; border-radius: 6mm; overflow: hidden; background: white; display: flex; flex-direction: column; }
          .card-header { background: #15803d; padding: 6mm 6mm 5mm; color: white; text-align: center; }
          .card-header h1 { font-size: 28pt; font-weight: 800; letter-spacing: 0.02em; line-height: 1; }
          .card-header p { font-size: 9pt; opacity: 0.85; margin-top: 2mm; letter-spacing: 0.05em; text-transform: uppercase; }
          .card-body { padding: 5mm 6mm; display: flex; flex-direction: column; align-items: center; gap: 3mm; flex: 1; }
          .farmer-photo { width: 28mm; height: 28mm; border-radius: 50%; object-fit: cover; border: 3px solid #16a34a; background: #f1f5f9; display: flex; align-items: center; justify-content: center; }
          .farmer-photo.placeholder { background: #f1f5f9; }
          .farmer-name { font-size: 16pt; font-weight: 700; color: #111; text-align: center; line-height: 1.1; }
          .farmer-code { font-family: monospace; font-size: 10pt; color: #6b7280; margin-top: 1mm; }
          .qr-wrap { padding: 2mm; border: 1.5px solid #e5e7eb; border-radius: 2mm; }
          .qr-wrap svg { display: block; width: 32mm; height: 32mm; }
          .info-grid { width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 4mm; border-top: 1px solid #e5e7eb; padding-top: 3mm; margin-top: 1mm; }
          .info-item label { font-size: 7pt; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; }
          .info-item p { font-size: 9pt; font-weight: 600; color: #374151; margin-top: 0.5mm; }
          .card-footer { background: #f0fdf4; padding: 3mm 6mm; text-align: center; border-top: 1px solid #bbf7d0; }
          .card-footer p { font-size: 7.5pt; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="card-header">
            <h1>AVDP Farmer</h1>
            <p>Identification Card</p>
          </div>
          <div class="card-body">
            ${photoBlock}
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
    const H = 60 + 115 + 60 + 160 + 12 + infoRows * 38 + 50;
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
    ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("AVDP Farmer", W / 2, 32);
    ctx.font = "9px sans-serif"; ctx.globalAlpha = 0.85;
    ctx.fillText("IDENTIFICATION CARD", W / 2, 49);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    let y = 70;

    // Photo circle (with silhouette placeholder when no photo)
    {
      const cx = W / 2, cy = y + 50, r = 48;
      // Background fill
      ctx.fillStyle = "#f1f5f9";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

      let drewPhoto = false;
      if (hasPhoto && photoUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); img.src = photoUrl; });
        if (img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
          const aspect = img.naturalWidth / img.naturalHeight;
          const dw = aspect > 1 ? r * 2 * aspect : r * 2;
          const dh = aspect > 1 ? r * 2 : r * 2 / aspect;
          ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
          ctx.restore();
          drewPhoto = true;
        }
      }
      if (!drewPhoto) {
        // Silhouette: head + shoulders
        ctx.fillStyle = "#94a3b8";
        ctx.beginPath(); ctx.arc(cx, cy - 12, 14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + 30, 26, Math.PI, 0, true);
        ctx.fill();
      }
      ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
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
        <div className="bg-green-700 px-4 py-3 text-white text-center">
          <p className="text-lg font-extrabold tracking-tight leading-none">AVDP Farmer</p>
          <p className="text-[10px] opacity-80 mt-1 tracking-wider uppercase">Identification Card</p>
        </div>

        {/* Body */}
        <div className="bg-white p-4 flex flex-col items-center gap-3">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-green-300 bg-slate-100 shrink-0 flex items-center justify-center">
            {photoUrl ? (
              <img src={photoUrl} alt={`${farmer.firstName} ${farmer.lastName}`} className="w-full h-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            )}
          </div>
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
