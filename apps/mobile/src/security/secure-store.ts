import { SECURE_INSTALLATION_ID_KEY, SECURE_REFRESH_TOKEN_KEY } from '@meutreino/shared';
import * as SecureStore from 'expo-secure-store';

const LAST_USER_ID_KEY = 'meutreino.last_user_id';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let memoryRefreshToken: string | null = null;
let memoryInstallationId: string | null = null;

async function secureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export function isSecureStoreAvailable(): Promise<boolean> {
  return secureStoreAvailable();
}

export async function saveRefreshToken(token: string): Promise<void> {
  if (await secureStoreAvailable()) {
    memoryRefreshToken = null;
    await SecureStore.setItemAsync(SECURE_REFRESH_TOKEN_KEY, token, options);
    return;
  }
  memoryRefreshToken = token;
}

export async function readRefreshToken(): Promise<string | null> {
  if (await secureStoreAvailable()) {
    return SecureStore.getItemAsync(SECURE_REFRESH_TOKEN_KEY, options);
  }
  return memoryRefreshToken;
}

export async function deleteRefreshToken(): Promise<void> {
  memoryRefreshToken = null;
  if (await secureStoreAvailable()) {
    await SecureStore.deleteItemAsync(SECURE_REFRESH_TOKEN_KEY, options);
  }
}

export async function readInstallationId(): Promise<string | null> {
  if (await secureStoreAvailable()) {
    return SecureStore.getItemAsync(SECURE_INSTALLATION_ID_KEY, options);
  }
  return memoryInstallationId;
}

export async function saveLastUserId(userId: string): Promise<void> {
  if (await secureStoreAvailable()) {
    await SecureStore.setItemAsync(LAST_USER_ID_KEY, userId, options);
  }
}

export async function readLastUserId(): Promise<string | null> {
  if (await secureStoreAvailable()) {
    return SecureStore.getItemAsync(LAST_USER_ID_KEY, options);
  }
  return null;
}

export async function deleteLastUserId(): Promise<void> {
  if (await secureStoreAvailable()) {
    await SecureStore.deleteItemAsync(LAST_USER_ID_KEY, options);
  }
}

export async function saveInstallationId(installationId: string): Promise<void> {
  if (await secureStoreAvailable()) {
    await SecureStore.setItemAsync(SECURE_INSTALLATION_ID_KEY, installationId, options);
    return;
  }
  memoryInstallationId = installationId;
}
