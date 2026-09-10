import AsyncStorage from "@react-native-async-storage/async-storage";

export interface OfflineCredentialRecord {
  farmer_id: number;
  token_hash: string;
  method: "offline_qr" | "offline_pin";
  expires_at: string;
}

export interface OfflineDispatchPack {
  version: 1;
  generatedAt: string;
  dispatchId: number;
  vehicleId: number | null;
  destination: {
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    geofenceRadiusM: number;
  } | null;
  arrivalPolicy: {
    minimumFixes: number;
    minimumDwellSeconds: number;
    maximumAccuracyM: number;
  };
  credentials: OfflineCredentialRecord[];
}

const keyFor = (dispatchId: number) => `@offline_dispatch_pack:${dispatchId}`;
const arrivalKeyFor = (dispatchId: number) => `@offline_arrival:${dispatchId}`;

export interface OfflineArrivalCapture {
  evidenceKey: string;
  dispatchId: number;
  fixes: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
    capturedAt: string;
  }>;
}

// Small dependency-free SHA-256 implementation so offline verification works
// in Expo/Hermes without WebCrypto, a cellular connection, or a shared secret.
export function sha256(value: string): string {
  const encoded: number[] = [];
  for (const character of value.trim()) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) encoded.push(code);
    else if (code < 0x800) encoded.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
    else if (code < 0x10000) encoded.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
    else encoded.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
  }
  const bytes = Uint8Array.from(encoded);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) words[i >> 2] = (words[i >> 2] || 0) | bytes[i] << (24 - (i % 4) * 8);
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | 0x80 << (24 - bitLength % 32);
  words[((bitLength + 64 >> 9) << 4) + 15] = bitLength;
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < words.length; offset += 16) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) w[i] = words[offset + i] | 0;
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) | 0;
      const s0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h = h.map((v,i) => (v + [a,b,c,d,e,f,g,hh][i]) | 0);
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8,"0")).join("");
}

export async function cacheOfflinePack(pack: OfflineDispatchPack): Promise<void> {
  await AsyncStorage.setItem(keyFor(pack.dispatchId), JSON.stringify(pack));
}

export async function loadOfflinePack(dispatchId: number): Promise<OfflineDispatchPack | null> {
  const raw = await AsyncStorage.getItem(keyFor(dispatchId));
  if (!raw) return null;
  try {
    const pack = JSON.parse(raw) as OfflineDispatchPack;
    return pack.version === 1 && pack.dispatchId === dispatchId ? pack : null;
  } catch { return null; }
}

export function matchOfflineCredential(
  pack: OfflineDispatchPack,
  farmerId: number,
  rawCredential: string,
): OfflineCredentialRecord | null {
  if (!rawCredential.trim()) return null;
  const digest = sha256(rawCredential);
  const now = Date.now();
  return pack.credentials.find((credential) =>
    Number(credential.farmer_id) === farmerId
    && credential.token_hash === digest
    && Date.parse(credential.expires_at) > now,
  ) ?? null;
}

function evidenceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `arrival-${Date.now()}-${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function appendArrivalFix(
  dispatchId: number,
  fix: OfflineArrivalCapture["fixes"][number],
): Promise<OfflineArrivalCapture> {
  const existing = await loadArrivalCapture(dispatchId);
  const capture: OfflineArrivalCapture = existing ?? { evidenceKey: evidenceKey(), dispatchId, fixes: [] };
  const updated = { ...capture, fixes: [...capture.fixes, fix].slice(-120) };
  await AsyncStorage.setItem(arrivalKeyFor(dispatchId), JSON.stringify(updated));
  return updated;
}

export async function loadArrivalCapture(dispatchId: number): Promise<OfflineArrivalCapture | null> {
  const raw = await AsyncStorage.getItem(arrivalKeyFor(dispatchId));
  if (!raw) return null;
  try {
    const capture = JSON.parse(raw) as OfflineArrivalCapture;
    return capture.dispatchId === dispatchId && Array.isArray(capture.fixes) ? capture : null;
  } catch { return null; }
}

export async function clearArrivalCapture(dispatchId: number): Promise<void> {
  await AsyncStorage.removeItem(arrivalKeyFor(dispatchId));
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isLocalArrivalConfirmed(pack: OfflineDispatchPack, capture: OfflineArrivalCapture): boolean {
  if (!pack.destination) return false;
  const acceptable = capture.fixes
    .filter(fix => Number.isFinite(Date.parse(fix.capturedAt))
      && fix.accuracy != null && fix.accuracy <= pack.arrivalPolicy.maximumAccuracyM
      && distanceMeters(fix.latitude, fix.longitude, pack.destination!.latitude, pack.destination!.longitude) <= pack.destination!.geofenceRadiusM)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (acceptable.length < pack.arrivalPolicy.minimumFixes) return false;
  const dwellSeconds = (Date.parse(acceptable[acceptable.length - 1].capturedAt) - Date.parse(acceptable[0].capturedAt)) / 1000;
  return dwellSeconds >= pack.arrivalPolicy.minimumDwellSeconds;
}
