import { create } from 'zustand';
import { globalOrchestrator } from '../providers/ProviderOrchestrator';
import { getSeedCatalog } from '../providers/seedCatalog';
import type {
  ConstellationGroup,
  DataProviderId,
  ObserverLocation,
  OrbitalRecord,
  ValidationComparisonResult,
} from '../types/satellite';

export const OBSERVER_PRESETS: ObserverLocation[] = [
  {
    name: 'Buenos Aires, AR',
    latitude: -34.6037,
    longitude: -58.3816,
    altitude: 25,
    isManual: true,
  },
  {
    name: 'Córdoba (CONAE), AR',
    latitude: -31.5241,
    longitude: -64.4635,
    altitude: 540,
    isManual: true,
  },
  {
    name: 'Ushuaia, AR (Lat. Alta)',
    latitude: -54.8019,
    longitude: -68.303,
    altitude: 15,
    isManual: true,
  },
  {
    name: 'Ecuador (Quito, 0°)',
    latitude: -0.1807,
    longitude: -78.4678,
    altitude: 2850,
    isManual: true,
  },
];

interface SatelliteStoreState {
  selectedSatellite: OrbitalRecord;
  activeGroup: ConstellationGroup;
  catalog: OrbitalRecord[];
  starlinkConstellation: OrbitalRecord[];
  showConstellationLayer: boolean;
  constellationLimit: number;
  showFootprint: boolean;
  showGroundTrack: boolean;
  minElevationDeg: number;
  ttlHours: number;
  notifyMinutesBefore: number;
  scheduledPassIds: Record<string, string>;
  observer: ObserverLocation;
  lastProviderUsed: DataProviderId | 'cache' | 'seed';
  lastFallbackChain: string[];
  isLoadingCatalog: boolean;
  validationHistory: ValidationComparisonResult[];

  // Actions
  selectSatellite: (record: OrbitalRecord) => void;
  setActiveGroup: (group: ConstellationGroup, forceRefresh?: boolean) => Promise<void>;
  refreshSelectedSatellite: () => Promise<OrbitalRecord>;
  loadStarlinkConstellation: (forceRefresh?: boolean) => Promise<void>;
  setShowConstellationLayer: (show: boolean) => void;
  setConstellationLimit: (limit: number) => void;
  setShowFootprint: (show: boolean) => void;
  setShowGroundTrack: (show: boolean) => void;
  setMinElevationDeg: (deg: number) => void;
  setTtlHours: (hours: number) => void;
  setNotifyMinutesBefore: (minutes: number) => void;
  registerScheduledNotification: (passId: string, notifId: string) => void;
  setObserver: (obs: ObserverLocation) => void;
  addValidationResult: (res: ValidationComparisonResult) => void;
  clearValidationHistory: () => void;
}

const initialSeed = getSeedCatalog('stations');
const initialIss = initialSeed.find((r) => r.noradId === 25544) ?? initialSeed[0];

export const useSatelliteStore = create<SatelliteStoreState>((set, get) => ({
  selectedSatellite: initialIss,
  activeGroup: 'stations',
  catalog: initialSeed,
  starlinkConstellation: getSeedCatalog('starlink'),
  showConstellationLayer: false,
  constellationLimit: 60,
  showFootprint: true,
  showGroundTrack: true,
  minElevationDeg: 10,
  ttlHours: 12,
  notifyMinutesBefore: 10,
  scheduledPassIds: {},
  observer: OBSERVER_PRESETS[0],
  lastProviderUsed: 'seed',
  lastFallbackChain: ['seed:initial'],
  isLoadingCatalog: false,
  validationHistory: [],

  selectSatellite: (record) => {
    set({ selectedSatellite: record });
  },

  setActiveGroup: async (group, forceRefresh = false) => {
    set({ activeGroup: group, isLoadingCatalog: true });
    try {
      const res = await globalOrchestrator.getCatalog(group, {
        ttlHours: get().ttlHours,
        forceRefresh,
      });
      const currentSelected = get().selectedSatellite;
      const updatedSelected =
        res.data.find((r) => r.noradId === currentSelected.noradId) ?? currentSelected;

      set({
        catalog: res.data,
        selectedSatellite: updatedSelected,
        lastProviderUsed: res.providerUsed,
        lastFallbackChain: res.fallbackChainAttempted,
        isLoadingCatalog: false,
      });

      if (group === 'starlink') {
        set({ starlinkConstellation: res.data });
      }
    } catch {
      set({
        catalog: getSeedCatalog(group),
        isLoadingCatalog: false,
      });
    }
  },

  refreshSelectedSatellite: async () => {
    const current = get().selectedSatellite;
    const res = await globalOrchestrator.getOrbitalData(current.noradId, {
      ttlHours: get().ttlHours,
      forceRefresh: true,
    });
    set({
      selectedSatellite: res.data,
      lastProviderUsed: res.providerUsed,
      lastFallbackChain: res.fallbackChainAttempted,
    });
    return res.data;
  },

  loadStarlinkConstellation: async (forceRefresh = false) => {
    try {
      const res = await globalOrchestrator.getCatalog('starlink', {
        ttlHours: get().ttlHours,
        forceRefresh,
      });
      set({
        starlinkConstellation: res.data,
        lastProviderUsed: res.providerUsed,
        lastFallbackChain: res.fallbackChainAttempted,
      });
    } catch {
      set({ starlinkConstellation: getSeedCatalog('starlink') });
    }
  },

  setShowConstellationLayer: (show) => {
    set({ showConstellationLayer: show });
    if (show && get().starlinkConstellation.length === 0) {
      get().loadStarlinkConstellation();
    }
  },

  setConstellationLimit: (limit) => set({ constellationLimit: Math.max(10, Math.min(200, limit)) }),
  setShowFootprint: (show) => set({ showFootprint: show }),
  setShowGroundTrack: (show) => set({ showGroundTrack: show }),
  setMinElevationDeg: (deg) => set({ minElevationDeg: Math.max(0, Math.min(60, deg)) }),
  setTtlHours: (hours) => set({ ttlHours: Math.max(1, Math.min(48, hours)) }),
  setNotifyMinutesBefore: (minutes) =>
    set({ notifyMinutesBefore: Math.max(1, Math.min(60, minutes)) }),

  registerScheduledNotification: (passId, notifId) =>
    set((state) => ({
      scheduledPassIds: { ...state.scheduledPassIds, [passId]: notifId },
    })),

  setObserver: (obs) => set({ observer: obs }),

  addValidationResult: (res) =>
    set((state) => ({
      validationHistory: [res, ...state.validationHistory].slice(0, 25),
    })),

  clearValidationHistory: () => set({ validationHistory: [] }),
}));

