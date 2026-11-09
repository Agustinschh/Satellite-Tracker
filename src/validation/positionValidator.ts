import { degreesToRadians } from 'satellite.js';
import { computeTelemetrySnapshot } from '../orbital/engine';
import { EARTH_RADIUS_KM } from '../orbital/footprint';
import { evaluateEphemerisAge } from '../providers/CacheManager';
import { globalOrchestrator } from '../providers/ProviderOrchestrator';
import type {
  ObserverLocation,
  OrbitalRecord,
  ValidationComparisonResult,
  ValidationExternalSample,
} from '../types/satellite';

/**
 * Great-circle Haversine distance on the Earth's surface (in km) between two (lat, lon) pairs.
 */
export function computeHaversineDistanceKm(
  lat1Deg: number,
  lon1Deg: number,
  lat2Deg: number,
  lon2Deg: number
): number {
  const dLat = degreesToRadians(lat2Deg - lat1Deg);
  const dLon = degreesToRadians(lon2Deg - lon1Deg);
  const rLat1 = degreesToRadians(lat1Deg);
  const rLat2 = degreesToRadians(lat2Deg);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  return EARTH_RADIUS_KM * c;
}

/**
 * Converts geodetic (lat, lon, altKm) to spherical/WGS84 ECEF (x, y, z) in km
 * to compute 3D Euclidean position error between two spatial coordinates.
 */
export function geodeticToApproxEcefKm(
  latDeg: number,
  lonDeg: number,
  altKm: number
): { x: number; y: number; z: number } {
  const lat = degreesToRadians(latDeg);
  const lon = degreesToRadians(lonDeg);
  const r = EARTH_RADIUS_KM + altKm;

  return {
    x: r * Math.cos(lat) * Math.cos(lon),
    y: r * Math.cos(lat) * Math.sin(lon),
    z: r * Math.sin(lat),
  };
}

/**
 * Compares a locally propagated SGP4 position at the exact timestamp of an external
 * validation sample (Where the ISS at? or N2YO) and computes surface & 3D error in km (RF-15).
 */
export function compareLocalWithExternal(
  record: OrbitalRecord,
  observer: ObserverLocation,
  external: ValidationExternalSample
): ValidationComparisonResult {
  const targetDate = new Date(external.timestamp);
  const localSnap = computeTelemetrySnapshot(record, observer, targetDate);

  if (!localSnap) {
    throw new Error(`Fallo en la propagación SGP4 local para NORAD ${record.noradId}`);
  }

  const deltaLatDeg = Math.abs(localSnap.latitude - external.latitude);
  let deltaLonDeg = Math.abs(localSnap.longitude - external.longitude);
  if (deltaLonDeg > 180) deltaLonDeg = 360 - deltaLonDeg;
  const deltaAltKm = Math.abs(localSnap.altitudeKm - external.altitudeKm);

  const surfaceDistanceKm = computeHaversineDistanceKm(
    localSnap.latitude,
    localSnap.longitude,
    external.latitude,
    external.longitude
  );

  const pLocal = geodeticToApproxEcefKm(
    localSnap.latitude,
    localSnap.longitude,
    localSnap.altitudeKm
  );
  const pExt = geodeticToApproxEcefKm(
    external.latitude,
    external.longitude,
    external.altitudeKm
  );

  const euclidean3dKm = Math.sqrt(
    Math.pow(pLocal.x - pExt.x, 2) +
      Math.pow(pLocal.y - pExt.y, 2) +
      Math.pow(pLocal.z - pExt.z, 2)
  );

  const deltaAzimuthDeg =
    external.azimuthDeg !== undefined
      ? Math.min(
          Math.abs(localSnap.azimuthDeg - external.azimuthDeg),
          360 - Math.abs(localSnap.azimuthDeg - external.azimuthDeg)
        )
      : undefined;

  const deltaElevationDeg =
    external.elevationDeg !== undefined
      ? Math.abs(localSnap.elevationDeg - external.elevationDeg)
      : undefined;

  const ageInfo = evaluateEphemerisAge(record);

  return {
    id: `${record.noradId}_${external.provider}_${external.timestamp}`,
    provider: external.provider,
    noradId: record.noradId,
    satName: record.name,
    timestamp: external.timestamp,
    local: {
      latitude: localSnap.latitude,
      longitude: localSnap.longitude,
      altitudeKm: localSnap.altitudeKm,
      azimuthDeg: localSnap.azimuthDeg,
      elevationDeg: localSnap.elevationDeg,
    },
    external,
    errors: {
      deltaLatDeg,
      deltaLonDeg,
      deltaAltKm,
      surfaceDistanceKm,
      euclidean3dKm,
      deltaAzimuthDeg,
      deltaElevationDeg,
    },
    epochIso: record.epoch,
    epochAgeHours: ageInfo.epochAgeHours,
  };
}

/**
 * Runs a live validation against `wheretheiss` (for NORAD 25544) or `n2yo` (for any satellite).
 */
export async function runLiveValidation(
  provider: 'wheretheiss' | 'n2yo',
  record: OrbitalRecord,
  observer: ObserverLocation
): Promise<ValidationComparisonResult> {
  const external = await globalOrchestrator.getValidationPosition(
    provider,
    record.noradId,
    observer
  );
  return compareLocalWithExternal(record, observer, external);
}

/**
 * Formats a list of validation runs as a Markdown table suitable for the TP7 validation report.
 */
export function formatValidationResultsMarkdown(
  results: ValidationComparisonResult[]
): string {
  const header = [
    '| Fecha/Hora (UTC) | Satélite (NORAD) | Fuente | Lat/Lon Local | Lat/Lon Externa | ΔAlt (km) | Error Superficie (km) | Error 3D (km) | Antigüedad Epoch (h) |',
    '|---|---|---|---|---|---:|---:|---:|---:|',
  ];

  const rows = results.map((r) => {
    const iso = new Date(r.timestamp).toISOString().replace('T', ' ').substring(0, 19);
    const locStr = `${r.local.latitude.toFixed(3)}°, ${r.local.longitude.toFixed(3)}°`;
    const extStr = `${r.external.latitude.toFixed(3)}°, ${r.external.longitude.toFixed(3)}°`;
    return `| ${iso} | ${r.satName} (${r.noradId}) | ${r.provider} | ${locStr} | ${extStr} | ${r.errors.deltaAltKm.toFixed(2)} | ${r.errors.surfaceDistanceKm.toFixed(2)} | ${r.errors.euclidean3dKm.toFixed(2)} | ${r.epochAgeHours.toFixed(1)} |`;
  });

  return [...header, ...rows].join('\n');
}

