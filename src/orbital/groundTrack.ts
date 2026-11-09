import type { GroundTrackResult, LatLngPoint, OrbitalRecord } from '../types/satellite';
import { classifyOrbitRegime, getOrbitalPeriodMinutes, propagateSubsatellitePoint } from './engine';

/**
 * Splits a continuous array of LatLng points into independent segments whenever
 * consecutive samples jump across the antimeridian (±180° longitude).
 * Interpolates the exact latitude at ±180° to avoid horizontal lines crossing the world map (RF-11).
 */
export function splitAtAntimeridian(points: LatLngPoint[]): LatLngPoint[][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0]]];

  const segments: LatLngPoint[][] = [];
  let currentSegment: LatLngPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const deltaLon = curr.longitude - prev.longitude;

    if (Math.abs(deltaLon) > 180) {
      // Satellite crossed the ±180° meridian
      const signPrev = prev.longitude >= 0 ? 1 : -1;
      const borderPrev = signPrev * 180;
      const borderCurr = -signPrev * 180;

      // Normalized angular distance travelled across the antimeridian
      const distPrevToBorder = Math.abs(borderPrev - prev.longitude);
      const distBorderToCurr = Math.abs(curr.longitude - borderCurr);
      const totalLonSpan = distPrevToBorder + distBorderToCurr;

      const fraction = totalLonSpan > 0 ? distPrevToBorder / totalLonSpan : 0.5;
      const crossingLat = prev.latitude + fraction * (curr.latitude - prev.latitude);

      currentSegment.push({
        latitude: crossingLat,
        longitude: borderPrev,
      });
      segments.push(currentSegment);

      currentSegment = [
        {
          latitude: crossingLat,
          longitude: borderCurr,
        },
        curr,
      ];
    } else {
      currentSegment.push(curr);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments.filter((seg) => seg.length >= 2);
}

/**
 * Computes the past (-0.5 orbit) and future (+1.0 full orbit) ground track
 * for a given satellite, choosing step size according to orbital regime (RF-11).
 */
export function computeGroundTrack(
  record: OrbitalRecord,
  referenceDate: Date = new Date()
): GroundTrackResult {
  const periodMinutes = getOrbitalPeriodMinutes(record.meanMotion);
  const regime = classifyOrbitRegime(record.meanMotion, record.eccentricity);

  // Step size: 30-45s for LEO, 120s for MEO, 300s for GEO
  const stepSeconds = regime === 'LEO' ? 40 : regime === 'MEO' ? 120 : 300;
  const pastDurationMs = Math.min(periodMinutes * 0.5, 720) * 60 * 1000;
  const futureDurationMs = Math.min(periodMinutes * 1.05, 1440) * 60 * 1000;
  const stepMs = stepSeconds * 1000;
  const refMs = referenceDate.getTime();

  const pastPoints: LatLngPoint[] = [];
  for (let t = refMs - pastDurationMs; t <= refMs; t += stepMs) {
    const pt = propagateSubsatellitePoint(record, new Date(t));
    if (pt) {
      pastPoints.push({ latitude: pt.latitude, longitude: pt.longitude });
    }
  }

  const futurePoints: LatLngPoint[] = [];
  for (let t = refMs; t <= refMs + futureDurationMs; t += stepMs) {
    const pt = propagateSubsatellitePoint(record, new Date(t));
    if (pt) {
      futurePoints.push({ latitude: pt.latitude, longitude: pt.longitude });
    }
  }

  return {
    pastSegments: splitAtAntimeridian(pastPoints),
    futureSegments: splitAtAntimeridian(futurePoints),
    periodMinutes,
    computedAt: refMs,
  };
}

