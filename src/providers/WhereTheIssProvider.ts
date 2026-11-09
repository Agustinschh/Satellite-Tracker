import type {
  DataProvider,
  ObserverLocation,
  OrbitalRecord,
  ValidationExternalSample,
} from '../types/satellite';
import { buildRecordFromTle } from './N2yoProvider';
import { fetchWithRetry } from './RateLimiter';

interface WhereTheIssPositionResponse {
  name: string;
  id: number;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number; // km/h
  timestamp: number; // Unix seconds
}

interface WhereTheIssTleResponse {
  header: string;
  line1: string;
  line2: string;
}

/**
 * Public REST API for the International Space Station (NORAD 25544):
 * https://api.wheretheiss.at/v1/satellites/25544
 * Requires no authentication; rate limited to 1 req/second.
 */
export class WhereTheIssProvider implements DataProvider {
  readonly id = 'wheretheiss' as const;
  readonly name = 'Where the ISS at?';
  readonly requiresAuth = false;

  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    if (noradId !== 25544) {
      throw new Error('Where the ISS at? solo provee datos para la ISS (NORAD 25544)');
    }

    const res = await fetchWithRetry(
      'wheretheiss',
      'https://api.wheretheiss.at/v1/satellites/25544/tles',
      undefined,
      1,
      8_000
    );
    const data = (await res.json()) as WhereTheIssTleResponse;

    if (!data.line1 || !data.line2) {
      throw new Error('Respuesta TLE incompleta de Where the ISS at?');
    }

    return buildRecordFromTle(
      25544,
      data.header || 'ISS (ZARYA)',
      data.line1,
      data.line2,
      'wheretheiss'
    );
  }

  async getValidationPosition(
    noradId: number,
    _observer: ObserverLocation
  ): Promise<ValidationExternalSample> {
    if (noradId !== 25544) {
      throw new Error('Where the ISS at? solo soporta validación de la ISS (NORAD 25544)');
    }

    const res = await fetchWithRetry(
      'wheretheiss',
      'https://api.wheretheiss.at/v1/satellites/25544',
      undefined,
      1,
      8_000
    );
    const data = (await res.json()) as WhereTheIssPositionResponse;

    return {
      provider: 'wheretheiss',
      noradId: 25544,
      timestamp: data.timestamp * 1000,
      latitude: data.latitude,
      longitude: data.longitude,
      altitudeKm: data.altitude,
      velocityKms: data.velocity / 3600, // km/h -> km/s
    };
  }
}

