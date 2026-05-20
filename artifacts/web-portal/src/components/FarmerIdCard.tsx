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

    // Strip hardcoded pixel width/height from SVG so CSS physical sizing takes over.
    // QRCodeSVG sets width="N" height="N" which prints at a fixed px size (~12mm at
    // 300dpi). Removing them while keeping viewBox makes the SVG scale with CSS.
    const rawSvg = card.querySelector("svg")?.outerHTML ?? "";
    const svgHtml = rawSvg
      .replace(/\s+width="[^"]*"/, "")
      .replace(/\s+height="[^"]*"/, "");

    const photoBlock = photoUrl
      ? `<div class="photo-wrap">
           <img src="${photoUrl}" alt="${farmer.firstName} ${farmer.lastName}" class="photo-img" crossorigin="anonymous" />
         </div>`
      : `<div class="photo-wrap">
           <div class="photo-placeholder">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:40%;height:40%">
               <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
             </svg>
           </div>
         </div>`;

    const infoItems = [
      farmer.gender         ? `<div class="info-item"><label>Gender</label><p>${farmer.gender}</p></div>` : "",
      farmer.districtName   ? `<div class="info-item"><label>District</label><p>${farmer.districtName}</p></div>` : "",
      farmer.chiefdomName   ? `<div class="info-item"><label>Chiefdom</label><p>${farmer.chiefdomName}</p></div>` : "",
      farmer.valueChainName ? `<div class="info-item"><label>Value Chain</label><p>${farmer.valueChainName}</p></div>` : "",
      farmer.phone          ? `<div class="info-item"><label>Phone</label><p>${farmer.phone}</p></div>` : "",
      `<div class="info-item"><label>Status</label><p style="color:${farmer.status === "approved" ? "#16a34a" : "#f59e0b"};text-transform:capitalize">${farmer.status ?? "—"}</p></div>`,
    ].join("");

    // Open a full-page window — @page CSS below controls the actual paper size/margins.
    const win = window.open("", "_blank", "width=800,height=1100");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Farmer ID — ${farmer.farmerCode}</title>
        <style>
          /* ── Page setup ──────────────────────────────────────────── */
          @page {
            size: A5 portrait;
            margin: 12mm;
          }

          * { margin: 0; padding: 0; box-sizing: border-box; }

          /* Screen: center the card nicely */
          body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #f3f4f6;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 24px;
            min-height: 100vh;
          }

          /* Print: no chrome, card fills the page */
          @media print {
            body {
              background: white;
              padding: 0;
              margin: 0;
              display: block;
            }
          }

          /* ── Card shell ──────────────────────────────────────────── */
          .card {
            width: 148mm;          /* A5 width minus 2×12mm margin */
            background: white;
            border: 2px solid #16a34a;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12);
            page-break-inside: avoid;
          }
          @media print {
            .card { box-shadow: none; border-radius: 8px; }
          }

          /* ── Header ──────────────────────────────────────────────── */
          .card-header {
            background: linear-gradient(135deg, #14532d 0%, #16a34a 100%);
            padding: 5mm 6mm;
            color: white;
            display: flex;
            align-items: center;
            gap: 4mm;
          }
          .header-logo {
            width: 11mm; height: 11mm;
            background: rgba(255,255,255,0.15);
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 5.5mm; font-weight: 900; color: white;
            flex-shrink: 0;
          }
          .header-text h1 { font-size: 4.8mm; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
          .header-text p  { font-size: 2.8mm; opacity: 0.75; margin-top: 0.5mm; }

          /* ── Body ────────────────────────────────────────────────── */
          .card-body {
            padding: 5mm 6mm 4mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4mm;
          }

          /* ── Photo ───────────────────────────────────────────────── */
          .photo-wrap {
            width: 22mm; height: 22mm;
            border-radius: 50%;
            overflow: hidden;
            border: 0.8mm solid #16a34a;
            flex-shrink: 0;
          }
          .photo-img { width: 100%; height: 100%; object-fit: cover; display: block; }
          .photo-placeholder {
            width: 100%; height: 100%;
            background: #f1f5f9;
            display: flex; align-items: center; justify-content: center;
          }

          /* ── Name / code ─────────────────────────────────────────── */
          .farmer-name { font-size: 5.5mm; font-weight: 700; color: #111827; text-align: center; line-height: 1.25; }
          .farmer-code { font-family: 'Courier New', monospace; font-size: 3mm; color: #6b7280; margin-top: 1mm; text-align: center; }

          .divider { width: 100%; border: none; border-top: 1px solid #e5e7eb; }

          /* ── QR section ──────────────────────────────────────────── */
          .qr-section { display: flex; flex-direction: column; align-items: center; gap: 2mm; }
          .qr-wrap {
            padding: 3mm;
            border: 0.4mm solid #e5e7eb;
            border-radius: 3mm;
            background: white;
            line-height: 0;
          }
          /* This is the key fix: force QR to a large physical size regardless of SVG attributes */
          .qr-wrap svg {
            width: 45mm !important;
            height: 45mm !important;
            display: block;
          }
          .qr-label { font-size: 2.5mm; color: #9ca3af; letter-spacing: 0.06em; text-transform: uppercase; }

          /* ── Info grid ───────────────────────────────────────────── */
          .info-grid {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2.5mm 5mm;
            border-top: 1px solid #e5e7eb;
            padding-top: 3.5mm;
          }
          .info-item label { font-size: 2.5mm; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; display: block; }
          .info-item p     { font-size: 3.2mm; font-weight: 600; color: #374151; margin-top: 0.5mm; }

          /* ── Footer ──────────────────────────────────────────────── */
          .card-footer {
            background: #f0fdf4;
            border-top: 1px solid #dcfce7;
            padding: 2.5mm 6mm;
            text-align: center;
          }
          .card-footer p { font-size: 2.5mm; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="card-header">
            <div class="header-logo">A</div>
            <div class="header-text">
              <h1>AVDP Farmer</h1>
              <p>Agricultural Verified Distribution Programme</p>
              <p style="margin-top:0.5mm;opacity:0.6;font-size:2.5mm">Agri-PoD Identification Card</p>
            </div>
          </div>
          <div class="card-body">
            ${photoBlock}
            <div>
              <div class="farmer-name">${farmer.firstName} ${farmer.lastName}</div>
              <div class="farmer-code">${farmer.farmerCode}</div>
            </div>
            <hr class="divider" />
            <div class="qr-section">
              <div class="qr-wrap">${svgHtml}</div>
              <div class="qr-label">Scan to verify identity</div>
            </div>
            ${infoItems ? `<div class="info-grid">${infoItems}</div>` : ""}
          </div>
          <div class="card-footer">
            <p>Present this card at distribution points for identification &amp; verification</p>
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

      {/* Hidden QR source for extraction */}
      <div ref={cardRef} className="hidden">
        <QRCodeSVG
          value={qrValue}
          size={400}
          level="H"
          includeMargin={false}
          style={{ display: "block" }}
        />
      </div>

      {/* Visual preview */}
      <div className="border-2 border-green-700 rounded-xl overflow-hidden shadow-sm">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-900 to-green-700 px-4 py-3 text-white flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-white font-black text-base shrink-0">A</div>
          <div>
            <p className="text-xs font-extrabold tracking-wider uppercase">AVDP Farmer</p>
            <p className="text-[9px] opacity-70 mt-0.5">Agricultural Verified Distribution Programme</p>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white px-4 py-4 flex flex-col items-center gap-3">
          {/* Photo */}
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-green-600 shadow-md ring-2 ring-green-100 flex-shrink-0">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={`${farmer.firstName} ${farmer.lastName}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            )}
          </div>

          {/* Name */}
          <div className="text-center">
            <p className="font-bold text-sm leading-tight">{farmer.firstName} {farmer.lastName}</p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{farmer.farmerCode}</p>
          </div>

          <hr className="w-full border-slate-100" />

          {/* QR */}
          <div className="p-2 border border-slate-200 rounded-lg bg-white">
            <QRCodeSVG
              value={qrValue}
              size={120}
              level="M"
              includeMargin={false}
            />
          </div>
          <p className="text-[8px] text-muted-foreground uppercase tracking-widest">Scan to verify identity</p>

          {/* Info grid */}
          <div className="w-full grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
            {farmer.gender && (
              <div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wide">Gender</p>
                <p className="text-[11px] font-semibold mt-0.5">{farmer.gender}</p>
              </div>
            )}
            {farmer.districtName && (
              <div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wide">District</p>
                <p className="text-[11px] font-semibold mt-0.5">{farmer.districtName}</p>
              </div>
            )}
            {farmer.valueChainName && (
              <div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wide">Value Chain</p>
                <p className="text-[11px] font-semibold mt-0.5">{farmer.valueChainName}</p>
              </div>
            )}
            {farmer.status && (
              <div>
                <p className="text-[8px] text-muted-foreground uppercase tracking-wide">Status</p>
                <p className={`text-[11px] font-semibold mt-0.5 capitalize ${farmer.status === "approved" ? "text-emerald-700" : "text-amber-700"}`}>
                  {farmer.status}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-green-50 border-t border-green-100 px-4 py-2 text-center">
          <p className="text-[8px] text-muted-foreground">Present this card at distribution points for identification</p>
        </div>
      </div>
    </div>
  );
}
