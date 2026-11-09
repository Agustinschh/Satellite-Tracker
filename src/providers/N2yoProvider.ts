import { twoline2satrec, radiansToDegrees } from 'satellite.js';
import type {
  DataProvider,
  ObserverLocation,
  OrbitalRecord,
  ValidationExternalSample,
} from '../types/satellite';
import { loadProviderCredentials } from './credentialsStore';
import { fetchWithRetry } from './RateLimiter';

/**
 * Parses epoch ISO timestamp from a TLE line 1 (columns 19-32: YYDDD.DDDDDDDD).
 */
export function parseTleEpochToIso(line1: string): string {
  try {
    const epochField = line1.substring(18, 32).trim();
    const year2 = parseInt(epochField.substring(0, 2), 10);
    const dayOfYear = parseFloat(epochField.substring(2));
    const fullYear = year2 >= 57 ? 1900 + year2 : 2000 + year2;
    const jan1 = Date.UTC(fullYear, 0, 1, 0, 0, 0, 0);
    const epochMs = jan1 + (dayOfYear - 1) * 86_400_000;
    return new Date(epochMs).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function buildRecordFromTle(
  noradId: number,
  name: string,
  line1: string,
  line2: string,
  source: 'n2yo' | 'wheretheiss'
): OrbitalRecord {
  const satrec = twoline2satrec(line1.trim(), line2.trim());
  // satrec.no is in rad/min -> convert to rev/day: (no * 1440) / (2 * PI)
  const meanMotion = (satrec.no * 1440) / (2 * Math.PI);
  const inclination = radiansToDegrees(satrec.inclo);
  const eccentricity = satrec.ecco;
  const epoch = parseTleEpochToIso(line1);

  return {
    noradId,
    name: name.trim() || `SAT-${noradId}`,
    format: 'tle',
    tle: { line1: line1.trim(), line2: line2.trim() },
    epoch,
    meanMotion,
    inclination,
    eccentricity,
    source,
    fetchedAt: Date.now(),
    satrec,
  };
}

interface N2yoTleResponse {
  info?: { satid: number; satname: string };
  tle?: string;
}

interface N2yoPositionsResponse {
  info?: { satid: number; satname: string };
  positions?: Array<{
    satlatitude: number;
    satlongitude: number;
    sataltitude: number;
    azimuth: number;
    elevation: number;
    timestamp: number;
  }>;
}

/**
 * N2YO REST API Provider (Cross-validation for any NORAD ID + TLE fallback).
 * Supports querying via optional backend proxy (`proxy/server.js`) or SecureStore API key.
 */
export class N2yoProvider implements DataProvider {
  readonly id = 'n2yo' as const;
  readonly name = 'N2YO API';
  readonly requiresAuth = true;

  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const creds = await loadProviderCredentials();
    let url: string;

    if (creds.proxyUrl) {
      url = `${creds.proxyUrl.replace(/\/$/, '')}/api/n2yo/tle/${noradId}`;
    } else if (creds.n2yoApiKey) {
      url = `https://api.n2yo.com/rest/v1/satellite/tle/${noradId}&apiKey=${encodeURIComponent(
        creds.n2yoApiKey
      )}`;
    } else {
      throw new Error('API Key de N2YO no configurada');
    }

    const res = await fetchWithRetry('n2yo', url, undefined, 1, 9_000);
    const data = (await res.json()) as N2yoTleResponse;

    if (!data.tle) {
      throw new Error(`N2YO no devolvió TLE para NORAD ${noradId}`);
    }

    const lines = data.tle
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('1 ') || l.startsWith('2 '));

    if (lines.length < 2) {
      throw new Error(`Formato TLE inválido desde N2YO para NORAD ${noradId}`);
    }

    return buildRecordFromTle(
      noradId,
      data.info?.satname ?? `SAT-${noradId}`,
      lines[0],
      lines[1],
      'n2yo'
    );
  }

  async getValidationPosition(
    noradId: number,
    observer: ObserverLocation
  ): Promise<ValidationExternalSample> {
    const creds = await loadProviderCredentials();
    const obsLat = observer.latitude.toFixed(4);
    const obsLon = observer.longitude.toFixed(4);
    const obsAlt = Math.round(observer.altitude || 0);

    let url: string;
    if (creds.proxyUrl) {
      url = `${creds.proxyUrl.replace(
        /\/$/,
        ''
      )}/api/n2yo/positions/${noradId}/${obsLat}/${obsLon}/${obsAlt}/1`;
    } else if (creds.n2yoApiKey) {
      url = `https://api.n2yo.com/rest/v1/satellite/positions/${noradId}/${obsLat}/${obsLon}/${obsAlt}/1/&apiKey=${encodeURIComponent(
        creds.n2yoApiKey
      )}`;
    } else {
      throw new Error(
        'Ingresa tu API Key gratuita de N2YO en la sección de Credenciales para validar cualquier satélite contra N2YO.'
      );
    }

    const res = await fetchWithRetry('n2yo', url, undefined, 1, 10_000);
    const data = (await res.json()) as N2yoPositionsResponse;

    if (!data.positions || data.positions.length === 0) {
      throw new Error(`N2YO no devolvió posiciones para NORAD ${noradId}`);
    }

    const pos = data.positions[0];
    return {
      provider: 'n2yo',
      noradId,
      timestamp: pos.timestamp * 1000,
      latitude: pos.satlatitude,
      longitude: pos.satlongitude,
      altitudeKm: pos.sataltitude,
      azimuthDeg: pos.azimuth,
      elevationDeg: pos.elevation,
    };
  }
}

