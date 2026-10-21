import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const googleDiscovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

export function appleSignInConfigured(): boolean {
  return Platform.OS === 'ios' && process.env.EXPO_PUBLIC_APPLE_SIGN_IN === 'true';
}

export function googleClientId(): string | null {
  const value =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
        : process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function googleRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'meutreino', path: 'oauth' });
}

export async function requestAppleCredential(): Promise<{
  identityToken: string;
  nonce: string;
  fullName: { givenName?: string; familyName?: string } | null;
} | null> {
  if (!appleSignInConfigured()) {
    return null;
  }
  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    return null;
  }
  const nonce = Crypto.randomUUID() + Crypto.randomUUID().replaceAll('-', '');
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) {
      return null;
    }
    return {
      identityToken: credential.identityToken,
      nonce,
      fullName: credential.fullName
        ? {
            givenName: credential.fullName.givenName ?? undefined,
            familyName: credential.fullName.familyName ?? undefined,
          }
        : null,
    };
  } catch (error) {
    if (isCancel(error)) {
      return null;
    }
    throw error;
  }
}

export async function requestGoogleCredential(): Promise<{
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
} | null> {
  const clientId = googleClientId();
  if (!clientId) {
    return null;
  }
  const redirectUri = googleRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: ['openid', 'profile', 'email'],
    usePKCE: true,
  });
  const result = await request.promptAsync(googleDiscovery);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return null;
  }
  if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
    throw new Error('O Google não concluiu a autorização.');
  }
  return {
    code: result.params.code,
    codeVerifier: request.codeVerifier,
    redirectUri,
    clientId,
  };
}

function isCancel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}
