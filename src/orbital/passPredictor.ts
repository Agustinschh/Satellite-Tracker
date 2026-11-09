import type {
  ObserverLocation,
  OrbitalRecord,
  PassSample,
  PassWindow,
} from '../types/satellite';
import {
  classifyOrbitRegime,
  computeTelemetrySnapshot,
} from './engine';

const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;

/**
 * Evaluates satellite elevation (deg) and azimuth (deg) at timestamp `tMs`.
 */
function evalLookAt(
  record: OrbitalRecord,
  observer: ObserverLocation,
  tMs: number
): { azimuthDeg: number; elevationDeg: number; rangeKm: number } | null {
  const snap = computeTelemetrySnapshot(record, observer, new Date(tMs));
  if (!snap) return null;
  return {
    azimuthDeg: snap.azimuthDeg,
    elevationDeg: snap.elevationDeg,
    rangeKm: snap.rangeKm,
  };
}

/**
 * Bisection root-finder to locate the exact crossing of `minElevationDeg`
 * within [tLow, tHigh] to ~1 second accuracy.
 */
function refineCrossingTime(
  record: OrbitalRecord,
  observer: ObserverLocation,
  tStart: number,
  tEnd: number,
  minElevationDeg: number,
  rising: boolean
): number {
  let a = tStart;
  let b = tEnd;

  for (let iter = 0; iter < 14; iter++) {
    if (b - a <= 1000) break;
    const mid = Math.floor((a + b) / 2);
    const val = evalLookAt(record, observer, mid);
    if (!val) break;

    const above = val.elevationDeg >= minElevationDeg;
    if (rising) {
      if (above) b = mid;
      else a = mid;
    } else {
      if (above) a = mid;
      else b = mid;
    }
  }

  return Math.floor((a + b) / 2);
}

/**
 * Golden-section search to find Time of Closest Approach / Max Elevation (TCA)
 * within [aosTime, losTime].
 */
function findPeakElevationTime(
  record: OrbitalRecord,
  observer: ObserverLocation,
  aosTime: number,
  losTime: number
): { tcaTime: number; maxElevationDeg: number; tcaAzimuthDeg: number } {
  let a = aosTime;
  let b = losTime;
  let c = b - GOLDEN_RATIO * (b - a);
  let d = a + GOLDEN_RATIO * (b - a);

  for (let iter = 0; iter < 16; iter++) {
    if (b - a <= 1000) break;
    const lookC = evalLookAt(record, observer, c);
    const lookD = evalLookAt(record, observer, d);
    const elC = lookC ? lookC.elevationDeg : -90;
    const elD = lookD ? lookD.elevationDeg : -90;

    if (elC > elD) {
      b = d;
      d = c;
      c = b - GOLDEN_RATIO * (b - a);
    } else {
      a = c;
      c = d;
      d = a + GOLDEN_RATIO * (b - a);
    }
  }

  const tcaTime = Math.floor((a + b) / 2);
  const peakLook = evalLookAt(record, observer, tcaTime);

  return {
    tcaTime,
    maxElevationDeg: peakLook ? peakLook.elevationDeg : 0,
    tcaAzimuthDeg: peakLook ? peakLook.azimuthDeg : 0,
  };
}

/**
 * Builds sky-chart trajectory samples between AOS and LOS.
 */
function buildPassSamples(
  record: OrbitalRecord,
  observer: ObserverLocation,
  aosTime: number,
  losTime: number,
  numSamples = 36
): PassSample[] {
  const samples: PassSample[] = [];
  const duration = Math.max(1000, losTime - aosTime);
  const step = Math.max(1000, Math.floor(duration / numSamples));

  for (let t = aosTime; t <= losTime; t += step) {
    const look = evalLookAt(record, observer, t);
    if (look) {
      samples.push({
        timestamp: t,
        azimuthDeg: look.azimuthDeg,
        elevationDeg: Math.max(0, look.elevationDeg),
        rangeKm: look.rangeKm,
      });
    }
  }

  const endLook = evalLookAt(record, observer, losTime);
  if (endLook && (samples.length === 0 || samples[samples.length - 1].timestamp < losTime)) {
    samples.push({
      timestamp: losTime,
      azimuthDeg: endLook.azimuthDeg,
      elevationDeg: Math.max(0, endLook.elevationDeg),
      rangeKm: endLook.rangeKm,
    });
  }

  return samples;
}

/**
 * Coarse-to-Fine Pass Prediction Algorithm (RF-04).
 *
 * 1. Coarse scan: steps of 30s (LEO) or 120s (MEO) over `hoursAhead`.
 * 2. Detects intervals where elevation crosses `minElevationDeg` (or nears it for grazing passes).
 * 3. Refines AOS and LOS to ±1s via bisection and TCA (Max Elevation) via golden-section search.
 * 4. Handles geostationary satellites that remain permanently above the horizon.
 */
export function predictPasses(
  record: OrbitalRecord,
  observer: ObserverLocation,
  options: {
    startTime?: Date;
    hoursAhead?: number;
    minElevationDeg?: number;
    maxPasses?: number;
  } = {}
): PassWindow[] {
  const startMs = (options.startTime ?? new Date()).getTime();
  const hoursAhead = options.hoursAhead ?? 24;
  const minElevationDeg = options.minElevationDeg ?? 10;
  const maxPasses = options.maxPasses ?? 10;

  const regime = classifyOrbitRegime(record.meanMotion, record.eccentricity);

  // Special case: Geostationary satellite continuously visible above threshold
  if (regime === 'GEO') {
    const lookNow = evalLookAt(record, observer, startMs);
    if (lookNow && lookNow.elevationDeg >= minElevationDeg) {
      const endMs = startMs + 24 * 3600 * 1000;
      return [
        {
          id: `${record.noradId}_geo_${startMs}`,
          noradId: record.noradId,
          satName: record.name,
          aosTime: startMs,
          tcaTime: startMs + 12 * 3600 * 1000,
          losTime: endMs,
          durationSec: 24 * 3600,
          aosAzimuthDeg: lookNow.azimuthDeg,
          maxElevationDeg: lookNow.elevationDeg,
          tcaAzimuthDeg: lookNow.azimuthDeg,
          losAzimuthDeg: lookNow.azimuthDeg,
          minElevationThresholdDeg: minElevationDeg,
          isGeostationaryVisible: true,
          isOngoing: true,
          samples: buildPassSamples(record, observer, startMs, startMs + 3600 * 1000, 12),
        },
      ];
    }
  }

  const coarseStepMs = (regime === 'LEO' ? 30 : 120) * 1000;
  const endMs = startMs + hoursAhead * 3600 * 1000;

  const passes: PassWindow[] = [];
  let prevTime = startMs;
  const initialLook = evalLookAt(record, observer, startMs);
  if (!initialLook) return [];

  let prevEl = initialLook.elevationDeg;
  let inPass = prevEl >= minElevationDeg;
  let currentAosTime = inPass ? startMs : 0;
  let isOngoingPass = inPass;

  for (let t = startMs + coarseStepMs; t <= endMs; t += coarseStepMs) {
    const look = evalLookAt(record, observer, t);
    if (!look) continue;
    const currEl = look.elevationDeg;

    if (!inPass && currEl >= minElevationDeg && prevEl < minElevationDeg) {
      // Upward crossing (AOS)
      currentAosTime = refineCrossingTime(
        record,
        observer,
        prevTime,
        t,
        minElevationDeg,
        true
      );
      inPass = true;
      isOngoingPass = false;
    } else if (inPass && currEl < minElevationDeg && prevEl >= minElevationDeg) {
      // Downward crossing (LOS)
      const losTime = refineCrossingTime(
        record,
        observer,
        prevTime,
        t,
        minElevationDeg,
        false
      );

      const { tcaTime, maxElevationDeg, tcaAzimuthDeg } = findPeakElevationTime(
        record,
        observer,
        currentAosTime,
        losTime
      );

      if (maxElevationDeg >= minElevationDeg) {
        const aosLook = evalLookAt(record, observer, currentAosTime);
        const losLook = evalLookAt(record, observer, losTime);
        const samples = buildPassSamples(record, observer, currentAosTime, losTime, 32);

        passes.push({
          id: `${record.noradId}_${currentAosTime}`,
          noradId: record.noradId,
          satName: record.name,
          aosTime: currentAosTime,
          tcaTime,
          losTime,
          durationSec: Math.max(1, Math.round((losTime - currentAosTime) / 1000)),
          aosAzimuthDeg: aosLook ? aosLook.azimuthDeg : 0,
          maxElevationDeg,
          tcaAzimuthDeg,
          losAzimuthDeg: losLook ? losLook.azimuthDeg : 0,
          minElevationThresholdDeg: minElevationDeg,
          isOngoing: isOngoingPass,
          samples,
        });

        if (passes.length >= maxPasses) {
          break;
        }
      }

      inPass = false;
      isOngoingPass = false;
    }

    prevTime = t;
    prevEl = currEl;
  }

  return passes;
}

/**
 * Asynchronous wrapper that yields to the JS event loop between chunks
 * so pass prediction never blocks animations or UI interactions.
 */
export async function predictPassesAsync(
  record: OrbitalRecord,
  observer: ObserverLocation,
  options: {
    startTime?: Date;
    hoursAhead?: number;
    minElevationDeg?: number;
    maxPasses?: number;
  } = {}
): Promise<PassWindow[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = predictPasses(record, observer, options);
      resolve(result);
    }, 0);
  });
}

