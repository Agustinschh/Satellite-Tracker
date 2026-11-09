import type { OMMJsonObject } from 'satellite.js';
import type {
  ConstellationGroup,
  DataProvider,
  OrbitalRecord,
} from '../types/satellite';
import { fetchWithRetry } from './RateLimiter';

/**
 * Normalizes a CelesTrak / Space-Track OMM JSON object into our internal OrbitalRecord.
 * Ensures EPOCH ends with 'Z' (UTC) for full compatibility with satellite.js json2satrec.
 */
export function normalizeOmmToRecord(
  raw: Record<string, unknown>,
  source: 'celestrak' | 'spacetrack',
  group?: ConstellationGroup
): OrbitalRecord {
  const noradId = Number(raw.NORAD_CAT_ID);
  const name = String(raw.OBJECT_NAME ?? `SAT-${noradId}`).trim();
  let epochStr = String(raw.EPOCH ?? new Date().toISOString()).trim();
  if (!epochStr.endsWith('Z') && !epochStr.includes('+')) {
    epochStr = `${epochStr}Z`;
  }

  const omm: OMMJsonObject = {
    OBJECT_NAME: name,
    OBJECT_ID: String(raw.OBJECT_ID ?? ''),
    EPOCH: epochStr,
    MEAN_MOTION: Number(raw.MEAN_MOTION ?? 15.0),
    ECCENTRICITY: Number(raw.ECCENTRICITY ?? 0),
    INCLINATION: Number(raw.INCLINATION ?? 0),
    RA_OF_ASC_NODE: Number(raw.RA_OF_ASC_NODE ?? 0),
    ARG_OF_PERICENTER: Number(raw.ARG_OF_PERICENTER ?? 0),
    MEAN_ANOMALY: Number(raw.MEAN_ANOMALY ?? 0),
    EPHEMERIS_TYPE: Number(raw.EPHEMERIS_TYPE ?? 0) as 0,
    CLASSIFICATION_TYPE: (String(raw.CLASSIFICATION_TYPE ?? 'U') as 'U') || 'U',
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: Number(raw.ELEMENT_SET_NO ?? 999),
    REV_AT_EPOCH: raw.REV_AT_EPOCH !== undefined ? Number(raw.REV_AT_EPOCH) : undefined,
    BSTAR: Number(raw.BSTAR ?? 0),
    MEAN_MOTION_DOT: Number(raw.MEAN_MOTION_DOT ?? 0),
    MEAN_MOTION_DDOT: Number(raw.MEAN_MOTION_DDOT ?? 0),
  };

  return {
    noradId,
    name,
    objectId: String(omm.OBJECT_ID),
    group,
    format: 'omm',
    omm,
    epoch: epochStr,
    meanMotion: Number(omm.MEAN_MOTION),
    inclination: Number(omm.INCLINATION),
    eccentricity: Number(omm.ECCENTRICITY),
    source,
    fetchedAt: Date.now(),
  };
}

/**
 * Primary orbital data provider: CelesTrak GP & Supplemental GP (SupGP).
 * - Uses SupGP (`sup-gp.php?FILE=starlink&FORMAT=json`) for Starlink ephemerides derived
 *   from SpaceX operator telemetry.
 * - Uses GP (`gp.php?GROUP=...&FORMAT=json`) for standard NORAD catalog groups.
 */
export class CelesTrakProvider implements DataProvider {
  readonly id = 'celestrak' as const;
  readonly name = 'CelesTrak (GP + SupGP)';
  readonly requiresAuth = false;

  async getCatalog(group: ConstellationGroup): Promise<OrbitalRecord[]> {
    const url =
      group === 'starlink'
        ? 'https://celestrak.org/NORAD/elements/supplemental/sup-gp.php?FILE=starlink&FORMAT=json'
        : `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(
            group
          )}&FORMAT=json`;

    const res = await fetchWithRetry('celestrak', url, undefined, 1, 12_000);
    const data = (await res.json()) as Record<string, unknown>[];

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`CelesTrak devolvió un catálogo vacío para el grupo ${group}`);
    }

    // For large constellations like Starlink (>6000 objects), cap in-memory parsed catalog to 300
    // to keep mobile memory footprint low while still supporting full search & constellation layer.
    const maxItems = group === 'starlink' ? 250 : 400;
    return data
      .slice(0, maxItems)
      .map((item) => normalizeOmmToRecord(item, 'celestrak', group));
  }

  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=json`;
    const res = await fetchWithRetry('celestrak', url, undefined, 1, 9_000);
    const data = (await res.json()) as Record<string, unknown>[];

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(`No se encontró NORAD ${noradId} en CelesTrak`);
    }

    return normalizeOmmToRecord(data[0], 'celestrak');
  }
}
