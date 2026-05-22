const getBase = () => {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${domain}/api`;
};

export async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string; message?: string }).error ?? (err as { message?: string }).message ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export interface Dispatch {
  id: number;
  manifestCode: string;
  campaignId: number;
  campaignName: string | null;
  vehicleId: number | null;
  driverId: number | null;
  warehouseId: number | null;
  warehouseName: string | null;
  plateNumber: string | null;
  driverName: string | null;
  destinationDistrict: string | null;
  destinationCommunity: string | null;
  fieldOfficerId: number | null;
  fieldOfficerName: string | null;
  status: string;
  totalPackages: number | null;
  deliveredPackages: number | null;
  departedAt: string | null;
  arrivedAt: string | null;
  notes: string | null;
  createdAt: string;
  items?: DispatchItem[];
}

export interface DispatchItem {
  id: number;
  dispatchId: number;
  inputItemId: number;
  inputItemName: string | null;
  unit: string | null;
  quantityLoaded: number | null;
  quantityDelivered: number | null;
  quantityReturned: number | null;
}

export interface Farmer {
  id: number;
  farmerCode: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: string | null;
  districtId: number | null;
  communityId: number | null;
  status: string;
  barcodeToken: string;
  photoUrl: string | null;
  ageGroup: string | null;
  farmSize: number | null;
  valueChainId: number | null;
  createdAt: string;
  beneficiaryType: string | null;
  farmerGroup: string | null;
  groupSize: number | null;
}

export function farmerDisplayName(farmer: Pick<Farmer, "firstName" | "lastName" | "beneficiaryType" | "farmerGroup">): string {
  if (farmer.beneficiaryType === "group" && farmer.farmerGroup) {
    return farmer.farmerGroup;
  }
  return `${farmer.firstName} ${farmer.lastName}`;
}

export interface PodStats {
  total: number;
  verified: number;
  pending: number;
  exceptions: number;
}

export interface InputItem {
  id: number;
  itemCode: string;
  name: string;
  category: string | null;
  unit: string | null;
  barcode: string | null;
}

export interface PoD {
  id: number;
  podCode: string;
  farmerId: number | null;
  dispatchId: number | null;
  campaignId: number | null;
  quantityDelivered: number | null;
  status: string;
  otpStatus: string | null;
  faceStatus: string | null;
  gpsStatus: string | null;
  farmerLatitude: number | null;
  farmerLongitude: number | null;
  inputItemId: number | null;
  inputBarcode: string | null;
  notes: string | null;
  submittedAt: string | null;
  farmerFirstName: string | null;
  farmerLastName: string | null;
  farmerGroup: string | null;
  farmerBeneficiaryType: string | null;
}

export const listDispatches = (token: string, params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return apiFetch<{ data: Dispatch[]; total: number }>(`/dispatch${qs}`, token);
};

export const getDispatch = (token: string, id: number) =>
  apiFetch<Dispatch>(`/dispatch/${id}`, token);

export const getDispatchByManifestCode = async (
  token: string,
  manifestCode: string
): Promise<Dispatch | null> => {
  const result = await apiFetch<{ data: Dispatch[]; total: number }>(
    `/dispatch?manifestCode=${encodeURIComponent(manifestCode)}&limit=1`,
    token
  );
  return result.data?.[0] ?? null;
};

export const listPoDs = (token: string, params: Record<string, string>) => {
  const qs = "?" + new URLSearchParams(params).toString();
  return apiFetch<{ data: PoD[]; total: number }>(`/pod${qs}`, token);
};

export const getPodStats = (token: string) =>
  apiFetch<PodStats>("/pod/stats", token);

export const farmerByBarcode = (token: string, barcode: string) =>
  apiFetch<Farmer>(`/farmers/barcode/${encodeURIComponent(barcode)}`, token);

export const searchFarmers = (
  token: string,
  search: string,
  filters?: { beneficiaryType?: "individual" | "group" }
) => {
  const params = new URLSearchParams({ limit: "10" });
  if (search) params.set("search", search);
  if (filters?.beneficiaryType) params.set("beneficiaryType", filters.beneficiaryType);
  return apiFetch<{ data: Farmer[] }>(`/farmers?${params.toString()}`, token);
};

export const submitPoD = (token: string, payload: Record<string, unknown>) =>
  apiFetch<PoD>("/pod/submit", token, { method: "POST", body: JSON.stringify(payload) });

export const inputByBarcode = (token: string, barcode: string) =>
  apiFetch<InputItem>(`/inventory/input-items/by-barcode/${encodeURIComponent(barcode)}`, token);

export interface GpsPingResult {
  success: boolean;
  arrivalStatus: "arrived" | null;
}

export const pingGps = (
  token: string,
  vehicleId: number,
  latitude: number,
  longitude: number,
  opts?: { dispatchId?: number; speed?: number; heading?: number; accuracy?: number }
) =>
  apiFetch<GpsPingResult>("/gps/ping", token, {
    method: "POST",
    body: JSON.stringify({ vehicleId, latitude, longitude, ...opts }),
  });

export interface OtpSendResult {
  sent: boolean;
  smsSent?: boolean;
  deliveryFailed?: boolean;
  channel?: "whatsapp" | "sms" | "none";
  maskedPhone: string;
  farmerName: string;
  devCode?: string;
}

export const sendOtp = (token: string, farmerId: number) =>
  apiFetch<OtpSendResult>("/pod/otp/send", token, {
    method: "POST",
    body: JSON.stringify({ farmerId }),
  });

export const verifyOtp = (token: string, farmerId: number, code: string) =>
  apiFetch<{ verified: boolean; error?: string }>("/pod/otp/verify", token, {
    method: "POST",
    body: JSON.stringify({ farmerId, code }),
  });

export const getOtpStatus = (token: string) =>
  apiFetch<{ otpEnabled: boolean }>("/pod/otp/status", token);

export const bypassOtp = (
  token: string,
  farmerId: number,
  dispatchId?: number,
  reason?: string
) =>
  apiFetch<{ bypassed: boolean; reason: string; farmerId: number }>(
    "/pod/otp/bypass",
    token,
    { method: "POST", body: JSON.stringify({ farmerId, dispatchId, reason }) }
  );

export interface FaceUploadResult {
  uploadUrl: string;
  key: string;
  bucket: string;
}

export interface FaceCompareResult {
  matched: boolean;
  similarity: number | null;
  reason: string;
  faceStatus: "Verified" | "Failed" | "NoFace" | "NoReference" | "Error";
  detail?: string;
}

export const getFaceUploadUrl = (token: string, farmerId: number, purpose: "reference" | "delivery") =>
  apiFetch<FaceUploadResult>("/face/upload-url", token, {
    method: "POST",
    body: JSON.stringify({ farmerId, purpose }),
  });

export const compareFace = (token: string, farmerId: number, deliveryKey: string) =>
  apiFetch<FaceCompareResult>("/face/compare", token, {
    method: "POST",
    body: JSON.stringify({ farmerId, deliveryKey }),
  });

export const saveFaceReference = (token: string, farmerId: number, key: string) =>
  apiFetch<{ success: boolean; photoUrl: string }>("/face/save-reference", token, {
    method: "POST",
    body: JSON.stringify({ farmerId, key }),
  });

export interface PodPhotoUploadResult {
  uploadUrl: string;
  key: string;
  bucket: string;
}

export const getPodPhotoUploadUrl = (token: string, farmerId: number, photoIndex: number) =>
  apiFetch<PodPhotoUploadResult>("/pod/photo-upload-url", token, {
    method: "POST",
    body: JSON.stringify({ farmerId, photoIndex }),
  });

export async function uploadPhotoToS3(uploadUrl: string, photoUri: string): Promise<void> {
  const response = await fetch(photoUri);
  const blob = await response.blob();
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);
}
