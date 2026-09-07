export type VehicleGpsMatchStatus =
  | "Matched"
  | "NearMatch"
  | "Mismatch"
  | "StaleVehicleLocation"
  | "NoVehicleLocation"
  | "NoMobileLocation";

export type GpsPoint = { lat: number | null; lng: number | null };

export interface VehicleGpsAssessment {
  status: VehicleGpsMatchStatus;
  distanceM: number | null;
  vehicleAgeSeconds: number | null;
}

function validPoint(point: GpsPoint): point is { lat: number; lng: number } {
  return point.lat != null && point.lng != null
    && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90
    && point.lng >= -180 && point.lng <= 180;
}

export function gpsDistanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusM = 6_371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function assessVehicleGpsMatch(input: {
  mobile: GpsPoint;
  vehicle: GpsPoint;
  vehicleRecordedAt?: string | null;
  matchRadiusM: number;
  nearRadiusM: number;
  maxVehicleAgeMinutes: number;
  nowMs?: number;
}): VehicleGpsAssessment {
  if (!validPoint(input.mobile)) return { status: "NoMobileLocation", distanceM: null, vehicleAgeSeconds: null };
  if (!validPoint(input.vehicle)) return { status: "NoVehicleLocation", distanceM: null, vehicleAgeSeconds: null };

  const distanceM = Math.round(gpsDistanceMeters(input.mobile, input.vehicle));
  const recordedMs = input.vehicleRecordedAt ? Date.parse(input.vehicleRecordedAt) : Number.NaN;
  const ageSeconds = Number.isFinite(recordedMs)
    ? Math.round(Math.abs((input.nowMs ?? Date.now()) - recordedMs) / 1000)
    : null;
  if (ageSeconds == null || ageSeconds > input.maxVehicleAgeMinutes * 60) {
    return { status: "StaleVehicleLocation", distanceM, vehicleAgeSeconds: ageSeconds };
  }
  if (distanceM <= input.matchRadiusM) return { status: "Matched", distanceM, vehicleAgeSeconds: ageSeconds };
  if (distanceM <= input.nearRadiusM) return { status: "NearMatch", distanceM, vehicleAgeSeconds: ageSeconds };
  return { status: "Mismatch", distanceM, vehicleAgeSeconds: ageSeconds };
}
