import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { getPublicCard } from "@/lib/db";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function FarmerCardPublic() {
  const params = useParams();
  const token = params.token ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-card", token],
    queryFn: () => getPublicCard(token),
    enabled: !!token,
    retry: 0,
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-white/80">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading card…</p>
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-white/90">
          <AlertTriangle className="h-10 w-10 text-amber-300" />
          <p className="text-base font-semibold">Card not found</p>
          <p className="text-xs text-white/70 text-center px-4 max-w-xs">
            This identification link is invalid or has been revoked. Please ask the field officer to re-issue the card.
          </p>
        </div>
      </Shell>
    );
  }

  const f = data;
  const fullName = `${f.firstName} ${f.lastName}`.trim();
  const statusColor =
    f.status === "approved" ? "bg-emerald-100 text-emerald-700" :
    f.status === "rejected" ? "bg-red-100 text-red-700" :
    "bg-amber-100 text-amber-700";

  return (
    <Shell>
      <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-green-700 px-5 py-5 text-white text-center">
          <p className="text-2xl font-extrabold tracking-tight leading-none">AVDP Farmer</p>
          <p className="text-[11px] opacity-85 mt-1.5 tracking-widest uppercase">Identification Card</p>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col items-center gap-4">
          {/* Photo */}
          <div className="w-32 h-32 rounded-full overflow-hidden border-[3px] border-green-500 bg-slate-100 flex items-center justify-center shadow-md">
            {f.photoUrl ? (
              <img src={f.photoUrl} alt={fullName} className="w-full h-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-20 h-20 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            )}
          </div>

          {/* Name + code */}
          <div className="text-center">
            <p className="text-xl font-bold text-slate-900 leading-tight">{fullName}</p>
            <p className="font-mono text-xs text-slate-500 mt-1">{f.farmerCode}</p>
            {f.status && (
              <span className={`inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusColor}`}>
                {f.status}
              </span>
            )}
          </div>

          {/* QR code */}
          <div className="p-2.5 border-2 border-slate-200 rounded-xl bg-white">
            <QRCodeSVG value={typeof window !== "undefined" ? window.location.href : f.barcodeToken} size={160} level="M" />
          </div>

          {/* Info grid */}
          <div className="w-full grid grid-cols-2 gap-x-3 gap-y-2.5 pt-3 border-t border-slate-200">
            {f.gender && <Info label="Gender"      value={f.gender} />}
            {f.phone &&  <Info label="Phone"       value={f.phone} />}
            {f.districtName    && <Info label="District"    value={f.districtName} />}
            {f.chiefdomName    && <Info label="Chiefdom"    value={f.chiefdomName} />}
            {f.valueChainName  && <Info label="Value Chain" value={f.valueChainName} />}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-green-50 border-t border-green-100 px-5 py-3 text-center">
          <p className="text-[10px] text-slate-600">Verify identity against the photo before distributing inputs.</p>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xs font-semibold text-slate-900 mt-0.5 break-words">{value}</p>
    </div>
  );
}
