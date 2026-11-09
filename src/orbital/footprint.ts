import { degreesToRadians, radiansToDegrees } from 'satellite.js';
import type { FootprintResult, LatLngPoint } from '../types/satellite';
import { splitAtAntimeridian } from './groundTrack';

export const EARTH_RADIUS_KM = 6371.0;

/**
 * Computes the geocentric central angle lambda (in radians) and surface coverage radius (in km)
 * for a satellite at `altitudeKm` given a minimum elevation threshold `minElevationDeg`.
 *
 * Formula (Spherical Earth / ITU-R geometry):
 *   lambda = arccos((R_E / (R_E + h)) * cos(epsilon_0)) - epsilon_0
 */
export function computeCoverageGeometry(
  altitudeKm: number,
  minElevationDeg = 0
): { centralAngleRad: number; centralAngleDeg: number; coverageRadiusKm: number } {
  const safeAlt = Math.max(0, altitudeKm);
  const epsRad = degreesToRadians(Math.max(0, Math.min(89, minElevationDeg)));

  const ratio = (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + safeAlt)) * Math.cos(epsRad);
  const clampedRatio = Math.max(-1, Math.min(1, ratio));

  const centralAngleRad = Math.max(0, Math.acos(clampedRatio) - epsRad);
  const centralAngleDeg = radiansToDegrees(centralAngleRad);
  const coverageRadiusKm = EARTH_RADIUS_KM * centralAngleRad;

  return {
    centralAngleRad,
    centralAngleDeg,
    coverageRadiusKm,
  };
}

/**
 * Computes a geodesic polygon of `numVertices` around `(subLatDeg, subLonDeg)`
 * representing the satellite's instantaneous footprint (RF-12).
 */
export function computeFootprint(
  subLatDeg: number,
  subLonDeg: number,
  altitudeKm: number,
  minElevationDeg = 0,
  numVertices = 72
): FootprintResult {
  const { centralAngleRad, centralAngleDeg, coverageRadiusKm } = computeCoverageGeometry(
    altitudeKm,
    minElevationDeg
  );

  if (centralAngleRad <= 0.001) {
    return {
      polygons: [],
      coverageRadiusKm: 0,
      centralAngleDeg: 0,
      minElevationDeg,
    };
  }

  const lat1 = degreesToRadians(subLatDeg);
  const lon1 = degreesToRadians(subLonDeg);
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(centralAngleRad);
  const cosD = Math.cos(centralAngleRad);

  const ring: LatLngPoint[] = [];

  for (let i = 0; i <= numVertices; i++) {
    const bearing = (2 * Math.PI * i) / numVertices;
    const sinLat2 = sinLat1 * cosD + cosLat1 * sinD * Math.cos(bearing);
    const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));

    const y = Math.sin(bearing) * sinD * cosLat1;
    const x = cosD - sinLat1 * Math.sin(lat2);
    let lon2 = lon1 + Math.atan2(y, x);

    // Normalize longitude to [-PI, PI]
    lon2 = ((lon2 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

    ring.push({
      latitude: radiansToDegrees(lat2),
      longitude: radiansToDegrees(lon2),
    });
  }

  // Split at antimeridian so polygons don't wrap across the entire map
  const segments = splitAtAntimeridian(ring);

  return {
    polygons: segments.length > 0 ? segments : [ring],
    coverageRadiusKm,
    centralAngleDeg,
    minElevationDeg,
  };
}

