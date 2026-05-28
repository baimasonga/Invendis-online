/**
 * Sierra Leone district centroid coordinates (WGS-84).
 * Keyed by districts.id from the database.
 * Geofence radius used when no distribution_site is configured: 2 000 m.
 *
 *  1  Western Area Urban (Freetown)
 *  2  Western Area Rural
 *  3  Bo
 *  4  Kenema
 *  5  Kailahun
 *  6  Kono
 *  7  Bombali
 *  8  Kambia
 *  9  Koinadugu
 * 10  Moyamba
 * 11  Pujehun
 * 12  Port Loko
 * 13  Tonkolili
 * 14  Falaba
 */
export const DISTRICT_COORDS: Record<number, { lat: number; lng: number }> = {
   1: { lat:  8.4840, lng: -13.2344 },
   2: { lat:  8.4038, lng: -13.1068 },
   3: { lat:  7.9647, lng: -11.7382 },
   4: { lat:  7.8769, lng: -11.1894 },
   5: { lat:  8.2760, lng: -10.5721 },
   6: { lat:  8.8820, lng: -10.8833 },
   7: { lat:  9.1929, lng: -11.9714 },
   8: { lat:  9.1229, lng: -12.9118 },
   9: { lat:  9.7771, lng: -11.2929 },
  10: { lat:  8.1606, lng: -12.4335 },
  11: { lat:  7.3522, lng: -11.7182 },
  12: { lat:  8.7638, lng: -12.8637 },
  13: { lat:  8.7163, lng: -11.8828 },
  14: { lat:  9.8525, lng: -11.3204 },
};

export const DISTRICT_GEOFENCE_RADIUS_M = 2_000;

export function districtCoords(districtId: number | null | undefined): { lat: number; lng: number } | null {
  if (districtId == null) return null;
  return DISTRICT_COORDS[districtId] ?? null;
}
