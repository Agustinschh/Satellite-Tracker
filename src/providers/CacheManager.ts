import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConstellationGroup, OrbitalRecord } from '../types/satellite';

const CACHE_PREFIX = '@tp7_sat_cache_v1:';
const DEFAULT_TTL_HOURS = 12;

export type EphemerisFreshness = 'fresh' | 'aging' | 'stale';

export interface EphemerisAgeInfo {
  epochAgeHours: number;
  cacheAgeHours: number;
  isCacheExpired: boolean;
  freshness: EphemerisFreshness;
  label: string;
}

/**
 * Evaluates both the age of the orbital element itself (`record.epoch`, which governs
 * SGP4 physical accuracy) and the age of the local cache entry (`record.fetchedAt`,
 * which governs TTL refresh every 12-24h per RF-09 and RF-16).
 */
export function evaluateEphemerisAge(
  record: OrbitalRecord,
  ttlHours = DEFAULT_TTL_HOURS,
  nowMs = Date.now()
): EphemerisAgeInfo {
  const epochMs = Date.parse(record.epoch);
  const epochAgeHours = Number.isNaN(epochMs)
    ? 0
    : Math.max(0, (nowMs - epochMs) / 3_600_000);

  const cacheAgeHours = Math.max(0, (nowMs - (record.fetchedAt || nowMs)) / 3_600_000);
  const isCacheExpired = cacheAgeHours >= ttlHours || record.source === 'seed';

  let freshness: EphemerisFreshness = 'fresh';
  if (epochAgeHours > 48 || isCacheExpired) {
    freshness = 'stale';
  } else if (epochAgeHours > 18) {
    freshness = 'aging';
  }

  const hoursRounded = epochAgeHours < 1
    ? `${Math.max(1, Math.round(epochAgeHours * 60))} min`
    : `${epochAgeHours.toFixed(1)} h`;

  const label =
    freshness === 'fresh'
      ? `Efeméride vigente (${hoursRounded})`
      : freshness === 'aging'
      ? `Efeméride intermedia (${hoursRounded})`
      : `Efeméride desactualizada (${hoursRounded})`;

  return {
    epochAgeHours,
    cacheAgeHours,
    isCacheExpired,
    freshness,
    label,
  };
}

export class CacheManager {
  private memoryCatalogCache = new Map<string, { records: OrbitalRecord[]; fetchedAt: number }>();
  private memorySatCache = new Map<number, OrbitalRecord>();

  async getGroupCatalog(
    group: ConstellationGroup,
    ttlHours = DEFAULT_TTL_HOURS,
    allowExpired = false
  ): Promise<OrbitalRecord[] | null> {
    const key = `${CACHE_PREFIX}group_${group}`;
    const mem = this.memoryCatalogCache.get(key);
    const ttlMs = ttlHours * 3_600_000;

    if (mem) {
      const expired = Date.now() - mem.fetchedAt > ttlMs;
      if (!expired || allowExpired) {
        return mem.records;
      }
    }

    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { records: OrbitalRecord[]; fetchedAt: number };
      this.memoryCatalogCache.set(key, parsed);

      for (const r of parsed.records) {
        this.memorySatCache.set(r.noradId, r);
      }

      const expired = Date.now() - parsed.fetchedAt > ttlMs;
      if (expired && !allowExpired) {
        return null;
      }
      return parsed.records;
    } catch {
      return null;
    }
  }

  async setGroupCatalog(group: ConstellationGroup, records: OrbitalRecord[]): Promise<void> {
    const key = `${CACHE_PREFIX}group_${group}`;
    const payload = {
      records: records.map(({ satrec: _omit, ...rest }) => rest),
      fetchedAt: Date.now(),
    };
    this.memoryCatalogCache.set(key, payload);
    for (const r of payload.records) {
      this.memorySatCache.set(r.noradId, r);
    }
    try {
      // Limit persisted Starlink array to 250 items in AsyncStorage to keep storage fast
      const persistedPayload = {
        ...payload,
        records: payload.records.slice(0, 250),
      };
      await AsyncStorage.setItem(key, JSON.stringify(persistedPayload));
    } catch {
      // Ignore storage quota warnings
    }
  }

  async getSatellite(
    noradId: number,
    ttlHours = DEFAULT_TTL_HOURS,
    allowExpired = false
  ): Promise<OrbitalRecord | null> {
    const ttlMs = ttlHours * 3_600_000;
    const mem = this.memorySatCache.get(noradId);
    if (mem) {
      const expired = Date.now() - mem.fetchedAt > ttlMs || mem.source === 'seed';
      if (!expired || allowExpired) {
        return mem;
      }
    }

    try {
      const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}sat_${noradId}`);
      if (!raw) return null;
      const record = JSON.parse(raw) as OrbitalRecord;
      this.memorySatCache.set(noradId, record);
      const expired = Date.now() - record.fetchedAt > ttlMs;
      if (expired && !allowExpired) return null;
      return record;
    } catch {
      return null;
    }
  }

  async setSatellite(record: OrbitalRecord): Promise<void> {
    const { satrec: _omit, ...clean } = record;
    this.memorySatCache.set(record.noradId, clean);
    try {
      await AsyncStorage.setItem(`${CACHE_PREFIX}sat_${record.noradId}`, JSON.stringify(clean));
    } catch {
      // Ignore storage quota warnings
    }
  }

  async clearAll(): Promise<void> {
    this.memoryCatalogCache.clear();
    this.memorySatCache.clear();
    try {
      const keys = await AsyncStorage.getAllKeys();
      const targetKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (targetKeys.length > 0) {
        await AsyncStorage.multiRemove(targetKeys);
      }
    } catch {
      // Ignore
    }
  }
}

export const globalCacheManager = new CacheManager();

