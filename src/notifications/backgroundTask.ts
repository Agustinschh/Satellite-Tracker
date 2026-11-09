import { predictPasses } from '../orbital/passPredictor';
import { evaluateEphemerisAge } from '../providers/CacheManager';
import { globalOrchestrator } from '../providers/ProviderOrchestrator';
import { useSatelliteStore } from '../store/useSatelliteStore';
import { schedulePassReminder } from './passNotifications';

export const BACKGROUND_ORBITAL_SYNC_TASK = 'TP7_BACKGROUND_ORBITAL_SYNC';

export interface BackgroundSyncSummary {
  executedAt: number;
  refreshedSatellite: boolean;
  recalculatedPassesCount: number;
  providerUsed: string;
}

/**
 * Executes a periodic background sync cycle (RF-06, RF-09):
 * 1. Checks if the active satellite's orbital elements exceed the configured TTL (12-24h).
 * 2. Refreshes orbital data via the ProviderOrchestrator respecting rate limits.
 * 3. Recalculates upcoming visibility windows (AOS/TCA/LOS) and re-aligns scheduled notifications.
 */
export async function runBackgroundOrbitalSync(
  forceRefresh = false
): Promise<BackgroundSyncSummary> {
  const state = useSatelliteStore.getState();
  const { selectedSatellite, observer, ttlHours, minElevationDeg, notifyMinutesBefore } = state;

  const age = evaluateEphemerisAge(selectedSatellite, ttlHours);
  let activeRecord = selectedSatellite;
  let refreshedSatellite = false;
  let providerUsed: string = selectedSatellite.source;

  if (forceRefresh || age.isCacheExpired) {
    const res = await globalOrchestrator.getOrbitalData(selectedSatellite.noradId, {
      ttlHours,
      forceRefresh: true,
    });
    activeRecord = res.data;
    providerUsed = res.providerUsed;
    refreshedSatellite = true;
    state.selectSatellite(activeRecord);
  }

  const upcomingPasses = predictPasses(activeRecord, observer, {
    hoursAhead: 24,
    minElevationDeg,
    maxPasses: 5,
  });

  // If the first upcoming pass is within the next 6 hours and not yet scheduled, schedule a reminder
  if (upcomingPasses.length > 0) {
    const nextPass = upcomingPasses[0];
    const hoursUntilAos = (nextPass.aosTime - Date.now()) / 3_600_000;
    if (hoursUntilAos > 0 && hoursUntilAos <= 6 && !state.scheduledPassIds[nextPass.id]) {
      const notifId = await schedulePassReminder(nextPass, notifyMinutesBefore);
      state.registerScheduledNotification(nextPass.id, notifId);
    }
  }

  return {
    executedAt: Date.now(),
    refreshedSatellite,
    recalculatedPassesCount: upcomingPasses.length,
    providerUsed,
  };
}

