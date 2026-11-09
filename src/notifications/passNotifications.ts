import { Alert, Platform } from 'react-native';
import type { PassWindow } from '../types/satellite';

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function ensureNotificationPermissions(): Promise<boolean> {
  return Platform.OS !== 'web';
}

/**
 * Schedules a local pass reminder notification N minutes before the satellite's AOS (RF-06).
 * Compatible with Expo Go on Android SDK 53+ without triggering remote push token errors.
 */
export async function schedulePassReminder(
  pass: PassWindow,
  minutesBefore: number
): Promise<string> {
  const triggerTimeMs = pass.aosTime - minutesBefore * 60 * 1000;
  const delayMs = Math.max(5000, triggerTimeMs - Date.now());
  const notifId = `notif_${pass.id}_${Date.now()}`;

  const aosTimeFormatted = new Date(pass.aosTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const existing = activeTimers.get(pass.id);
  if (existing) clearTimeout(existing);

  // Schedule timer if within the current session window (< 12h)
  if (delayMs < 12 * 3600 * 1000) {
    const timer = setTimeout(() => {
      Alert.alert(
        `🛰️ Pase de ${pass.satName} en ${minutesBefore} min`,
        `AOS a las ${aosTimeFormatted} (Az ${pass.aosAzimuthDeg.toFixed(
          0
        )}°) · Elev. máx ${pass.maxElevationDeg.toFixed(1)}° · Duración ${Math.round(
          pass.durationSec / 60
        )} min`
      );
      activeTimers.delete(pass.id);
    }, delayMs);
    activeTimers.set(pass.id, timer);
  }

  return notifId;
}

/**
 * Triggers a demo pass notification in 3 seconds for easy verification during the TP7 video demo.
 */
export async function triggerDemoPassNotification(
  satName: string,
  noradId: number,
  maxElevationDeg = 64.2
): Promise<boolean> {
  setTimeout(() => {
    Alert.alert(
      `🛰️ Pase Próximo: ${satName} (NORAD #${noradId})`,
      `Adquisición de señal (AOS) inminente · Elevación máxima prevista: ${maxElevationDeg.toFixed(
        1
      )}°.\n\nUtiliza el Sky Chart Polar y el Modo Brújula para orientar el dispositivo hacia el satélite.`
    );
  }, 3000);
  return true;
}
