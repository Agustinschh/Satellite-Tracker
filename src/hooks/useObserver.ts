import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { useSatelliteStore } from '../store/useSatelliteStore';

export function useObserver() {
  const observer = useSatelliteStore((s) => s.observer);
  const setObserver = useSatelliteStore((s) => s.setObserver);
  const [permissionStatus, setPermissionStatus] = useState<string>('undetermined');
  const [isLocating, setIsLocating] = useState(false);

  const requestGpsLocation = useCallback(async () => {
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status);
      if (status !== 'granted') {
        setIsLocating(false);
        return false;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setObserver({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        altitude: pos.coords.altitude ?? 25,
        name: 'Mi Ubicación GPS',
        isManual: false,
      });
      setIsLocating(false);
      return true;
    } catch {
      setIsLocating(false);
      return false;
    }
  }, [setObserver]);

  useEffect(() => {
    // Request initial GPS position on mount if not manually overridden
    requestGpsLocation();
  }, [requestGpsLocation]);

  return {
    observer,
    setObserver,
    permissionStatus,
    isLocating,
    requestGpsLocation,
  };
}

