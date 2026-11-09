import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY_N2YO = 'tp7_n2yo_api_key';
const KEY_ST_USER = 'tp7_spacetrack_user';
const KEY_ST_PASS = 'tp7_spacetrack_pass';
const KEY_PROXY_URL = 'tp7_proxy_url';

export interface ProviderCredentials {
  n2yoApiKey: string;
  spaceTrackIdentity: string;
  spaceTrackPassword: string;
  proxyUrl: string;
}

async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(key, value);
      return;
    }
  } catch {
    // Fallback to AsyncStorage if SecureStore is unavailable (e.g. web / simulator)
  }
  await AsyncStorage.setItem(`@secure_${key}`, value);
}

async function getSecureItem(key: string): Promise<string> {
  try {
    if (Platform.OS !== 'web') {
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) return val;
    }
  } catch {
    // Fallback
  }
  return (await AsyncStorage.getItem(`@secure_${key}`)) ?? '';
}

export async function loadProviderCredentials(): Promise<ProviderCredentials> {
  const [n2yoApiKey, spaceTrackIdentity, spaceTrackPassword, proxyUrl] = await Promise.all([
    getSecureItem(KEY_N2YO),
    getSecureItem(KEY_ST_USER),
    getSecureItem(KEY_ST_PASS),
    getSecureItem(KEY_PROXY_URL),
  ]);

  return {
    n2yoApiKey: n2yoApiKey.trim(),
    spaceTrackIdentity: spaceTrackIdentity.trim(),
    spaceTrackPassword: spaceTrackPassword.trim(),
    proxyUrl: proxyUrl.trim(),
  };
}

export async function saveProviderCredentials(creds: Partial<ProviderCredentials>): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (creds.n2yoApiKey !== undefined) {
    tasks.push(setSecureItem(KEY_N2YO, creds.n2yoApiKey.trim()));
  }
  if (creds.spaceTrackIdentity !== undefined) {
    tasks.push(setSecureItem(KEY_ST_USER, creds.spaceTrackIdentity.trim()));
  }
  if (creds.spaceTrackPassword !== undefined) {
    tasks.push(setSecureItem(KEY_ST_PASS, creds.spaceTrackPassword.trim()));
  }
  if (creds.proxyUrl !== undefined) {
    tasks.push(setSecureItem(KEY_PROXY_URL, creds.proxyUrl.trim()));
  }
  await Promise.all(tasks);
}

