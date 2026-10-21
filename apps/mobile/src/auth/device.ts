import type { DeviceInput } from '@meutreino/shared';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { readInstallationId, saveInstallationId } from '@/security/secure-store';

export async function currentDevice(): Promise<DeviceInput> {
  const existing = await readInstallationId();
  const installationId = existing ?? Crypto.randomUUID();
  if (!existing) {
    await saveInstallationId(installationId);
  }
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  return {
    installationId,
    platform,
    appVersion: Constants.expoConfig?.version ?? '0.1.0',
    label: platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android' : 'Navegador',
  };
}
