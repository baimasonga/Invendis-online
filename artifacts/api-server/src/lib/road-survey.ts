export interface SurveyPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
}

export interface SurveyProcessingResult {
  segments: SurveyPoint[][];
  rawPointCount: number;
  acceptedPointCount: number;
  discardedPointCount: number;
  segmentCount: number;
  gapCount: number;
  distanceKm: number;
  averageSpeedKmh: number | null;
  qualityStatus: "Good" | "Needs Review" | "Insufficient";
  processingNotes: string;
}

const EARTH_RADIUS_METRES = 6_371_000;

export function surveyDistanceMetres(a: SurveyPoint, b: SurveyPoint): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(h));
}

function validPoint(point: SurveyPoint): boolean {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90 && point.latitude <= 90
    && point.longitude >= -180 && point.longitude <= 180
    && Number.isFinite(new Date(point.recorded_at).getTime());
}

export function processSurveyTrack(
  input: SurveyPoint[],
  options: { maxGapMinutes?: number; maxImpliedSpeedKmh?: number; minMoveMetres?: number; maxAccuracyMetres?: number } = {},
): SurveyProcessingResult {
  const maxGapMs = (options.maxGapMinutes ?? 5) * 60_000;
  const maxImpliedSpeedKmh = options.maxImpliedSpeedKmh ?? 160;
  const minMoveMetres = options.minMoveMetres ?? 5;
  const maxAccuracyMetres = options.maxAccuracyMetres ?? 100;
  const ordered = [...input].sort((a, b) =>
    new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  const segments: SurveyPoint[][] = [];
  let current: SurveyPoint[] = [];
  let discarded = 0;
  let gaps = 0;
  let distanceMetres = 0;
  let speedTotal = 0;
  let speedCount = 0;

  const finishSegment = () => {
    if (current.length >= 2) segments.push(current);
    else discarded += current.length;
    current = [];
  };

  for (const point of ordered) {
    if (!validPoint(point) || (point.accuracy != null && point.accuracy > maxAccuracyMetres)) {
      discarded++;
      continue;
    }
    if (!current.length) {
      current.push(point);
      continue;
    }

    const previous = current[current.length - 1];
    const elapsedMs = new Date(point.recorded_at).getTime() - new Date(previous.recorded_at).getTime();
    if (elapsedMs <= 0) {
      discarded++;
      continue;
    }
    if (elapsedMs > maxGapMs) {
      gaps++;
      finishSegment();
      current.push(point);
      continue;
    }

    const stepMetres = surveyDistanceMetres(previous, point);
    const impliedSpeedKmh = stepMetres / elapsedMs * 3_600;
    if (impliedSpeedKmh > maxImpliedSpeedKmh) {
      discarded++;
      continue;
    }
    if (stepMetres < minMoveMetres) {
      discarded++;
      continue;
    }

    current.push(point);
    distanceMetres += stepMetres;
    const speed = point.speed == null ? impliedSpeedKmh : Number(point.speed);
    if (Number.isFinite(speed) && speed >= 0) {
      speedTotal += speed;
      speedCount++;
    }
  }
  finishSegment();

  const accepted = segments.reduce((sum, segment) => sum + segment.length, 0);
  const distanceKm = Math.round(distanceMetres) / 1000;
  const density = distanceKm > 0 ? accepted / distanceKm : 0;
  const qualityStatus = accepted < 2 || distanceKm === 0
    ? "Insufficient"
    : gaps === 0 && discarded / Math.max(input.length, 1) <= 0.1 && density >= 5
      ? "Good"
      : "Needs Review";
  const notes = [
    `${segments.length} continuous segment${segments.length === 1 ? "" : "s"}`,
    `${gaps} signal gap${gaps === 1 ? "" : "s"} over ${options.maxGapMinutes ?? 5} minutes`,
    `${discarded} invalid, stationary, low-accuracy or implausible point${discarded === 1 ? "" : "s"} excluded`,
  ].join("; ");

  return {
    segments,
    rawPointCount: input.length,
    acceptedPointCount: accepted,
    discardedPointCount: discarded,
    segmentCount: segments.length,
    gapCount: gaps,
    distanceKm,
    averageSpeedKmh: speedCount ? Math.round(speedTotal / speedCount * 100) / 100 : null,
    qualityStatus,
    processingNotes: notes,
  };
}
