import type {
  ConstellationGroup,
  DataProvider,
  OrbitalRecord,
} from '../types/satellite';
import { normalizeOmmToRecord } from './CelesTrakProvider';
import { loadProviderCredentials } from './credentialsStore';
import { fetchWithRetry } from './RateLimiter';

/**
 * Fallback catalog provider: Space-Track.org (18th SDS official catalog).
 * Respects strict rate limits (< 30 req/min, < 300 req/hour) via RateLimiter.
 * Supports querying through the optional Node.js credential proxy (`proxy/server.js`)
 * or direct authenticated requests using SecureStore credentials.
 */
export class SpaceTrackProvider implements DataProvider {
  readonly id = 'spacetrack' as const;
  readonly name = 'Space-Track.org';
  readonly requiresAuth = true;

  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const creds = await loadProviderCredentials();

    // 1. Prefer backend proxy if configured
    if (creds.proxyUrl) {
      const url = `${creds.proxyUrl.replace(/\/$/, '')}/api/spacetrack/gp/${noradId}`;
      const res = await fetchWithRetry('spacetrack', url, undefined, 1, 10_000);
      const data = (await res.json()) as Record<string, unknown>[];
      if (Array.isArray(data) && data.length > 0) {
        return normalizeOmmToRecord(data[0], 'spacetrack');
      }
    }

    if (!creds.spaceTrackIdentity || !creds.spaceTrackPassword) {
      throw new Error('Credenciales de Space-Track no configuradas');
    }

    // 2. Direct authentication against Space-Track REST API
    const loginRes = await fetchWithRetry(
      'spacetrack',
      'https://www.space-track.org/ajaxauth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          identity: creds.spaceTrackIdentity,
          password: creds.spaceTrackPassword,
          query: `https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`,
        }).toString(),
      },
      1,
      12_000
    );

    const data = (await loginRes.json()) as Record<string, unknown>[];
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`Space-Track no devolvió datos para NORAD ${noradId}`);
    }

    return normalizeOmmToRecord(data[0], 'spacetrack');
  }

  async getCatalog(group: ConstellationGroup): Promise<OrbitalRecord[]> {
    const creds = await loadProviderCredentials();
    if (creds.proxyUrl) {
      const url = `${creds.proxyUrl.replace(/\/$/, '')}/api/spacetrack/group/${group}`;
      const res = await fetchWithRetry('spacetrack', url, undefined, 1, 12_000);
      const data = (await res.json()) as Record<string, unknown>[];
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item) => normalizeOmmToRecord(item, 'spacetrack', group));
      }
    }
    throw new Error('Catálogo grupal de Space-Track requiere proxy o consulta específica por NORAD ID');
  }
}

