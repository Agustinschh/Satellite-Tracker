const mockStore = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k, v) => {
      mockStore.set(k, v);
    }),
    getAllKeys: jest.fn(async () => Array.from(mockStore.keys())),
    multiRemove: jest.fn(async (keys) => {
      keys.forEach((k) => mockStore.delete(k));
    }),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k, v) => {
    mockStore.set(k, v);
  }),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s) => s, absoluteFillObject: {} },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'mock_notif_id'),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

