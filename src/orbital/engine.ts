import {
  degreesLat,
  degreesLong,
   degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  radiansToDegrees,
  twoline2satrec,
  type SatRec,
} from 'satellite.js';
import type {
  LookAngles,
  ObserverLocation,
  OrbitalRecord,
  OrbitRegime,
  SubsatellitePoint,
  TelemetrySnapshot,
} from '../types/satellite';

/**
 * In-memory cache of compiled SatRec instances keyed by `${noradId}_${epoch}`
 * to avoid re-parsing TLE/OMM strings on every UI frame.
 */
const satrecCache = new Map<string, SatRec>();

/**
 * Parses an OrbitalRecord (OMM JSON or 2-line TLE) into a satellite.js SatRec.
 */
export function getSatRec(record: OrbitalRecord): SatRec {
  if (record.satrec) {
    return record.satrec;
  }

  const cacheKey = `${record.noradId}_${record.epoch}`;
  const cached = satrecCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let satrec: SatRec;
  if (record.format === 'omm' && record.omm) {
    satrec = json2satrec(record.omm);
  } else if (record.tle) {
    satrec = twoline2satrec(record.tle.line1, record.tle.line2);
  } else {
    throw new Error(`Registro orbital inválido para NORAD ${record.noradId}: falta OMM y TLE`);
  }

  if (satrecCache.size > 6000) {
    satrecCache.clear();
  }
  satrecCache.set(cacheKey, satrec);
  return satrec;
}

/**
 * Classifies the orbital regime from mean motion (rev/day) and eccentricity.
 * Note: SGP4/SDP4 in satellite.js automatically switches to deep-space (SDP4)
 * when orbital period > 225 minutes (meanMotion < 6.4 rev/day).
 */
export function classifyOrbitRegime(meanMotion: number, eccentricity = 0): OrbitRegime {
  if (eccentricity >= 0.25) return 'HEO';
  if (meanMotion >= 11.25) return 'LEO'; // Period <= 128 min (~2000 km alt)
  if (meanMotion >= 0.9 && meanMotion <= 1.1) return 'GEO'; // ~24h period (~35,786 km)
  return 'MEO'; // GPS, Galileo, GLONASS (~12h period)
}

/**
 * Computes orbital period in minutes from mean motion (revolutions/day).
 */
export function getOrbitalPeriodMinutes(meanMotion: number): number {
  if (!meanMotion || meanMotion <= 0) return 92;
  return 1440 / meanMotion;
}

/**
 * Propagates a satellite's position to the given Date using SGP4/SDP4
 * and returns its geodetic subsatellite point (lat, lon, alt) and velocity.
 */
export function propagateSubsatellitePoint(
  record: OrbitalRecord,
  date: Date = new Date()
): SubsatellitePoint | null {
  const satrec = getSatRec(record);
  const pv = propagate(satrec, date);

  if (!pv || !pv.position || typeof pv.position === 'boolean' || satrec.error !== 0) {
    return null;
  }

  const positionEci = pv.position;
  const velocityEci =
    pv.velocity && typeof pv.velocity !== 'boolean'
      ? pv.velocity
      : { x: 0, y: 0, z: 0 };

  const gmst = gstime(date);
  const geodetic = eciToGeodetic(positionEci, gmst);
  const positionEcf = eciToEcf(positionEci, gmst);

  const latitude = degreesLat(geodetic.latitude);
  const longitude = degreesLong(geodetic.longitude);
  const altitudeKm = geodetic.height;

  const velocityKms = Math.sqrt(
    velocityEci.x * velocityEci.x +
      velocityEci.y * velocityEci.y +
      velocityEci.z * velocityEci.z
  );

  return {
    latitude,
    longitude,
    altitudeKm,
    velocityKms,
    eciKm: {
      x: positionEci.x,
      y: positionEci.y,
      z: positionEci.z,
    },
    ecefKm: {
      x: positionEcf.x,
      y: positionEcf.y,
      z: positionEcf.z,
    },
    timestamp: date.getTime(),
  };
}

/**
 * Computes topocentric look angles (Azimuth, Elevation, Range) from an observer's GPS position
 * to a propagated satellite position.
 * IMPORTANT: observer.altitude is in meters (from GPS), converted to km for satellite.js.
 */
export function computeLookAnglesFromEcef(
  ecefKm: { x: number; y: number; z: number },
  observer: ObserverLocation
): LookAngles {
  const observerGd = {
    longitude: degreesToRadians(observer.longitude),
    latitude: degreesToRadians(observer.latitude),
    height: (observer.altitude || 0) / 1000, // m -> km
  };

  const lookAngles = ecfToLookAngles(observerGd, ecefKm);

  let azimuthDeg = radiansToDegrees(lookAngles.azimuth);
  if (azimuthDeg < 0) azimuthDeg += 360;

  const elevationDeg = radiansToDegrees(lookAngles.elevation);
  const rangeKm = lookAngles.rangeSat;

  return {
    azimuthDeg,
    elevationDeg,
    rangeKm,
  };
}

/**
 * Full real-time telemetry snapshot combining subsatellite geodetic coordinates
 * and topocentric look angles from the observer.
 */
export function computeTelemetrySnapshot(
  record: OrbitalRecord,
  observer: ObserverLocation,
  date: Date = new Date()
): TelemetrySnapshot | null {
  const subPoint = propagateSubsatellitePoint(record, date);
  if (!subPoint) return null;

  const look = computeLookAnglesFromEcef(subPoint.ecefKm, observer);
  const periodMinutes = getOrbitalPeriodMinutes(record.meanMotion);
  const orbitRegime = classifyOrbitRegime(record.meanMotion, record.eccentricity);

  return {
    ...subPoint,
    ...look,
    noradId: record.noradId,
    name: record.name,
    orbitRegime,
    periodMinutes,
  };
}

/**
 * Batch propagation for constellation layer (RF-13).
 * Propagates up to `limit` satellites and returns lightweight marker telemetry.
 */
export function propagateConstellationBatch(
  records: OrbitalRecord[],
  observer: ObserverLocation,
  date: Date = new Date(),
  limit = 100
): TelemetrySnapshot[] {
  const results: TelemetrySnapshot[] = [];
  const count = Math.min(records.length, limit);

  for (let i = 0; i < count; i++) {
    const snap = computeTelemetrySnapshot(records[i], observer, date);
    if (snap && !Number.isNaN(snap.latitude) && !Number.isNaN(snap.longitude)) {
      results.push(snap);
    }
  }

  return results;
}

