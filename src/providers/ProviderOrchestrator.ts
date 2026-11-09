import type {
  ConstellationGroup,
  DataProviderId,
  ObserverLocation,
  OrbitalRecord,
  ValidationExternalSample,
} from '../types/satellite';
import { globalCacheManager } from './CacheManager';
import { CelesTrakProvider } from './CelesTrakProvider';
import { N2yoProvider } from './N2yoProvider';
import { getSeedCatalog } from './seedCatalog';
import { SpaceTrackProvider } from './SpaceTrackProvider';
import { WhereTheIssProvider } from './WhereTheIssProvider';

export interface OrchestratorFetchResult<T> {
  data: T;
  providerUsed: DataProviderId | 'cache' | 'seed';
  fallbackChainAttempted: string[];
  usedStaleCache: boolean;
}

/**
 * Data Provider Orchestrator (RF-14):
 * Abstracts CelesTrak, Space-Track, N2YO, and Where the ISS at? behind a unified
 * interface with automatic TTL caching, rate-limiting, provider failover, and offline fallback.
 */
export class ProviderOrchestrator {
  private celestrak = new CelesTrakProvider();
  private spacetrack = new SpaceTrackProvider();
  private n2yo = new N2yoProvider();
  private wheretheiss = new WhereTheIssProvider();

  /**
   * Obtains a constellation catalog with automatic cache TTL check and provider failover:
   * 1. Valid local cache (< TTL)
   * 2. CelesTrak (GP or SupGP Starlink)
   * 3. Space-Track.org (if configured)
   * 4. Expired local cache (offline resilience)
   * 5. Embedded seed catalog
   */
  async getCatalog(
    group: ConstellationGroup,
    options: { ttlHours?: number; forceRefresh?: boolean } = {}
  ): Promise<OrchestratorFetchResult<OrbitalRecord[]>> {
    const ttlHours = options.ttlHours ?? 12;
    const chain: string[] = [];

    if (!options.forceRefresh) {
      const cached = await globalCacheManager.getGroupCatalog(group, ttlHours, false);
      if (cached && cached.length > 0) {
        return {
          data: cached,
          providerUsed: 'cache',
          fallbackChainAttempted: ['cache:hit'],
          usedStaleCache: false,
        };
      }
    }

    // 1. Primary: CelesTrak
    try {
      chain.push('celestrak');
      const records = await this.celestrak.getCatalog(group);
      await globalCacheManager.setGroupCatalog(group, records);
      return {
        data: records,
        providerUsed: 'celestrak',
        fallbackChainAttempted: chain,
        usedStaleCache: false,
      };
    } catch (err) {
      chain.push(`celestrak:error(${err instanceof Error ? err.message : 'fail'})`);
    }

    // 2. Fallback: Space-Track
    try {
      chain.push('spacetrack');
      const records = await this.spacetrack.getCatalog(group);
      await globalCacheManager.setGroupCatalog(group, records);
      return {
        data: records,
        providerUsed: 'spacetrack',
        fallbackChainAttempted: chain,
        usedStaleCache: false,
      };
    } catch {
      chain.push('spacetrack:skip');
    }

    // 3. If stations group and ISS is reachable via WhereTheISS, enrich seed catalog with live ISS TLE
    if (group === 'stations') {
      try {
        chain.push('wheretheiss');
        const issRecord = await this.wheretheiss.getOrbitalData(25544);
        const seed = getSeedCatalog(group).map((r) =>
          r.noradId === 25544 ? { ...issRecord, group: 'stations' as const } : r
        );
        await globalCacheManager.setGroupCatalog(group, seed);
        return {
          data: seed,
          providerUsed: 'wheretheiss',
          fallbackChainAttempted: chain,
          usedStaleCache: false,
        };
      } catch {
        chain.push('wheretheiss:skip');
      }
    }

    // 4. Stale cache fallback
    const stale = await globalCacheManager.getGroupCatalog(group, ttlHours, true);
    if (stale && stale.length > 0) {
      chain.push('cache:stale');
      return {
        data: stale,
        providerUsed: 'cache',
        fallbackChainAttempted: chain,
        usedStaleCache: true,
      };
    }

    // 5. Embedded seed fallback
    chain.push('seed');
    const seed = getSeedCatalog(group);
    return {
      data: seed,
      providerUsed: 'seed',
      fallbackChainAttempted: chain,
      usedStaleCache: true,
    };
  }

  /**
   * Obtains orbital elements for a single satellite by NORAD ID with full failover:
   * Cache -> CelesTrak -> WhereTheISS (if 25544) -> Space-Track -> N2YO -> Stale Cache / Seed
   */
  async getOrbitalData(
    noradId: number,
    options: { ttlHours?: number; forceRefresh?: boolean } = {}
  ): Promise<OrchestratorFetchResult<OrbitalRecord>> {
    const ttlHours = options.ttlHours ?? 12;
    const chain: string[] = [];

    if (!options.forceRefresh) {
      const cached = await globalCacheManager.getSatellite(noradId, ttlHours, false);
      if (cached) {
        return {
          data: cached,
          providerUsed: 'cache',
          fallbackChainAttempted: ['cache:hit'],
          usedStaleCache: false,
        };
      }
    }

    const providersToTry = [
      this.celestrak,
      ...(noradId === 25544 ? [this.wheretheiss] : []),
      this.spacetrack,
      this.n2yo,
    ];

    for (const provider of providersToTry) {
      try {
        chain.push(provider.id);
        const record = await provider.getOrbitalData(noradId);
        await globalCacheManager.setSatellite(record);
        return {
          data: record,
          providerUsed: provider.id,
          fallbackChainAttempted: chain,
          usedStaleCache: false,
        };
      } catch (err) {
        chain.push(`${provider.id}:fail(${err instanceof Error ? err.message : 'err'})`);
      }
    }

    const stale = await globalCacheManager.getSatellite(noradId, ttlHours, true);
    if (stale) {
      chain.push('cache:stale');
      return {
        data: stale,
        providerUsed: 'cache',
        fallbackChainAttempted: chain,
        usedStaleCache: true,
      };
    }

    const seedMatch = getSeedCatalog('active').find((r) => r.noradId === noradId);
    if (seedMatch) {
      chain.push('seed');
      return {
        data: seedMatch,
        providerUsed: 'seed',
        fallbackChainAttempted: chain,
        usedStaleCache: true,
      };
    }

    throw new Error(
      `No se pudieron obtener elementos orbitales para NORAD ${noradId} (${chain.join(' -> ')})`
    );
  }

  /**
   * Fetches an independent external position for validation (RF-15).
   */
  async getValidationPosition(
    provider: 'wheretheiss' | 'n2yo',
    noradId: number,
    observer: ObserverLocation
  ): Promise<ValidationExternalSample> {
    if (provider === 'wheretheiss') {
      return this.wheretheiss.getValidationPosition(noradId, observer);
    }
    return this.n2yo.getValidationPosition(noradId, observer);
  }
}

export const globalOrchestrator = new ProviderOrchestrator();

