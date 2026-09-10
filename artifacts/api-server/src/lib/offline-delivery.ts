import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const OFFLINE_ARRIVAL_POLICY = {
  minimumFixes: 3,
  minimumDwellSeconds: 180,
  maximumAccuracyM: 50,
} as const;

export type ArrivalFix = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  capturedAt: string;
  altitude?: number | null;
  speed?: number | null;
  heading?: number | null;
};

export function credentialHash(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function createOfflineVoucher(input: {
  dispatchId: number;
  farmerId: number;
  expiresAt: string;
  signingSecret: string;
}): string {
  if (input.signingSecret.length < 32) throw new Error("Offline voucher signing secret must be at least 32 characters");
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    d: input.dispatchId,
    f: input.farmerId,
    exp: input.expiresAt,
    n: randomBytes(16).toString("base64url"),
  })).toString("base64url");
  const signature = createHmac("sha256", input.signingSecret).update(payload).digest("base64url");
  return `AVDP1.${payload}.${signature}`;
}

export function verifyOfflineVoucher(token: string, signingSecret: string): boolean {
  if (signingSecret.length < 32) return false;
  const [prefix, payload, supplied] = token.trim().split(".");
  if (prefix !== "AVDP1" || !payload || !supplied) return false;
  const expected = createHmac("sha256", signingSecret).update(payload).digest();
  let suppliedBuffer: Buffer;
  try { suppliedBuffer = Buffer.from(supplied, "base64url"); } catch { return false; }
  if (expected.length !== suppliedBuffer.length || !timingSafeEqual(expected, suppliedBuffer)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded?.v === 1 && Number.isInteger(decoded?.d) && Number.isInteger(decoded?.f)
      && typeof decoded?.exp === "string" && Date.parse(decoded.exp) > Date.now();
  } catch { return false; }
}

export function createOfflinePin(): string {
  return randomInt(10_000_000, 100_000_000).toString();
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function assessArrivalEvidence(
  fixes: ArrivalFix[],
  destination: { latitude: number; longitude: number; geofenceRadiusM: number },
) {
  const valid = fixes
    .filter((fix) => Number.isFinite(fix.latitude) && fix.latitude >= -90 && fix.latitude <= 90
      && Number.isFinite(fix.longitude) && fix.longitude >= -180 && fix.longitude <= 180
      && Number.isFinite(Date.parse(fix.capturedAt)))
    .map((fix) => ({
      ...fix,
      accuracy: fix.accuracy == null ? null : Number(fix.accuracy),
      capturedMs: Date.parse(fix.capturedAt),
      distanceM: Math.round(haversineMeters(fix.latitude, fix.longitude, destination.latitude, destination.longitude)),
    }))
    .sort((a, b) => a.capturedMs - b.capturedMs);
  const acceptable = valid.filter((fix) =>
    fix.accuracy != null && fix.accuracy <= OFFLINE_ARRIVAL_POLICY.maximumAccuracyM
    && fix.distanceM <= destination.geofenceRadiusM,
  );
  const dwellSeconds = acceptable.length > 1
    ? Math.max(0, Math.round((acceptable[acceptable.length - 1].capturedMs - acceptable[0].capturedMs) / 1000))
    : 0;
  const verified = acceptable.length >= OFFLINE_ARRIVAL_POLICY.minimumFixes
    && dwellSeconds >= OFFLINE_ARRIVAL_POLICY.minimumDwellSeconds;
  return {
    status: verified ? "GPS Verified" as const : "Needs Review" as const,
    validFixes: valid,
    acceptableFixCount: acceptable.length,
    dwellSeconds,
    minimumDistanceM: valid.length ? Math.min(...valid.map((fix) => fix.distanceM)) : null,
    bestAccuracyM: valid.some((fix) => fix.accuracy != null)
      ? Math.min(...valid.flatMap((fix) => fix.accuracy == null ? [] : [fix.accuracy]))
      : null,
  };
}
