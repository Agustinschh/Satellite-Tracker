import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export interface DeviceOrientation {
  headingDeg: number; // 0..360 (0 = North, 90 = East)
  pitchDeg: number;   // 0..90 elevation angle when holding device up toward the sky
  hasHardwareSensor: boolean;
}

/**
 * Provides real-time device azimuth heading and elevation pitch for the Compass Overlay (RF-07).
 * Includes low-pass smoothing and manual simulation controls for emulators without a magnetometer.
 */
export function useHeading(enabled = true) {
  const [headingDeg, setHeadingDeg] = useState<number>(0);
  const [pitchDeg, setPitchDeg] = useState<number>(25);
  const [hasHardwareSensor, setHasHardwareSensor] = useState<boolean>(false);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;

    let headingSub: Location.LocationSubscription | null = null;
    let accelSub: { remove: () => void } | null = null;
    let isMounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted' && isMounted) {
          headingSub = await Location.watchHeadingAsync((headingData) => {
            if (!isMounted) return;
            const rawHeading =
              headingData.trueHeading >= 0 ? headingData.trueHeading : headingData.magHeading;
            if (rawHeading >= 0) {
              setHasHardwareSensor(true);
              setHeadingDeg((prev) => {
                // Smooth wrap-around low-pass filter
                let diff = rawHeading - prev;
                if (diff > 180) diff -= 360;
                if (diff < -180) diff += 360;
                return (prev + 0.25 * diff + 360) % 360;
              });
            }
          });
        }
      } catch {
        // Sensor unavailable on emulator
      }

      try {
        const available = await Accelerometer.isAvailableAsync();
        if (available && isMounted) {
          Accelerometer.setUpdateInterval(150);
          accelSub = Accelerometer.addListener(({ y, z }) => {
            if (!isMounted) return;
            // Estimate device elevation pitch in degrees when pointing phone toward sky
            const computedPitch = Math.max(
              0,
              Math.min(90, Math.round(Math.atan2(-z, y) * (180 / Math.PI) + 45))
            );
            if (!Number.isNaN(computedPitch)) {
              setPitchDeg((prev) => Math.round(prev * 0.75 + computedPitch * 0.25));
            }
          });
        }
      } catch {
        // Accelerometer unavailable on emulator
      }
    })();

    return () => {
      isMounted = false;
      headingSub?.remove();
      accelSub?.remove();
    };
  }, [enabled]);

  return {
    headingDeg,
    pitchDeg,
    hasHardwareSensor,
    setSimulatedHeadingDeg: setHeadingDeg,
    setSimulatedPitchDeg: setPitchDeg,
  };
}

