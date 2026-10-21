import {
  acceptedResponseSchema,
  accountSchema,
  exportStatusSchema,
  loginResponseSchema,
  sessionListSchema,
  sessionTokensSchema,
  type AccountView,
  type ProfileUpdate,
  type Reauthentication,
  type SessionTokens,
} from '@meutreino/shared';
import type { ZodType } from 'zod';
import { getApiBaseUrl } from '@/api/health';
import { ApiClientError, readApiError } from '@/api/errors';
import { deleteRefreshToken, readRefreshToken, saveRefreshToken } from '@/security/secure-store';
import { clearAccessToken, readAccessToken, setAccessToken } from '@/session/token-memory';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
};

const revokedListeners = new Set<() => void>();
let refreshInFlight: Promise<SessionTokens> | null = null;

export function onSessionRevoked(listener: () => void): () => void {
  revokedListeners.add(listener);
  return () => {
    revokedListeners.delete(listener);
  };
}

export async function storeSession(tokens: SessionTokens): Promise<void> {
  setAccessToken(tokens.accessToken, tokens.accessTokenExpiresAt);
  await saveRefreshToken(tokens.refreshToken);
}

export async function clearSessionSecrets(): Promise<void> {
  clearAccessToken();
  await deleteRefreshToken();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function apiRequest(path: string, options: RequestOptions): Promise<unknown> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new ApiClientError(
      'Defina EXPO_PUBLIC_API_URL para usar a conta.',
      0,
      'api_not_configured',
    );
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auth !== false) {
    const accessToken = readAccessToken() ?? (await refreshAccessToken());
    if (!accessToken) {
      throw new ApiClientError('Entre novamente para continuar.', 401, 'unauthenticated');
    }
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiClientError('Sem conexão com o servidor.', 0, 'network_error');
  }

  if (response.status === 401 && options.auth !== false && !options.retry) {
    clearAccessToken();
    await refreshAccessToken();
    return apiRequest(path, { ...options, retry: true });
  }

  const body = await parseBody(response);
  if (!response.ok) {
    throw readApiError(response.status, body);
  }
  return body;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    return null;
  }
  try {
    const tokens = await rotateRefreshToken(refreshToken);
    return tokens.accessToken;
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) {
      throw error;
    }
    await clearSessionSecrets();
    for (const listener of revokedListeners) {
      listener();
    }
    return null;
  }
}

function rotateRefreshToken(refreshToken: string): Promise<SessionTokens> {
  refreshInFlight ??= performRefresh(refreshToken).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(refreshToken: string): Promise<SessionTokens> {
  const body = await apiRequest('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
    auth: false,
  });
  const tokens = sessionTokensSchema.parse(body);
  await storeSession(tokens);
  return tokens;
}

async function parse<T>(body: unknown, schema: ZodType<T>): Promise<T> {
  return schema.parse(body);
}

export async function registerAccount(input: {
  displayName: string;
  email: string;
  password: string;
  acceptTerms: true;
  acceptPrivacy: true;
}): Promise<void> {
  const body = await apiRequest('/api/v1/auth/register', {
    method: 'POST',
    body: input,
    auth: false,
  });
  await parse(body, acceptedResponseSchema);
}

export async function loginAccount(input: {
  email: string;
  password: string;
  device: unknown;
}): Promise<{ tokens: SessionTokens; account: AccountView }> {
  const body = await apiRequest('/api/v1/auth/login', { method: 'POST', body: input, auth: false });
  const result = await parse(body, loginResponseSchema);
  await storeSession(result.tokens);
  return result;
}

export async function loginWithApple(
  input: unknown,
): Promise<{ tokens: SessionTokens; account: AccountView }> {
  const body = await apiRequest('/api/v1/auth/apple', { method: 'POST', body: input, auth: false });
  const result = await parse(body, loginResponseSchema);
  await storeSession(result.tokens);
  return result;
}

export async function loginWithGoogle(
  input: unknown,
): Promise<{ tokens: SessionTokens; account: AccountView }> {
  const body = await apiRequest('/api/v1/auth/google', {
    method: 'POST',
    body: input,
    auth: false,
  });
  const result = await parse(body, loginResponseSchema);
  await storeSession(result.tokens);
  return result;
}

export async function restoreSession(): Promise<AccountView> {
  await refreshAccessToken();
  return fetchAccount();
}

export async function fetchAccount(): Promise<AccountView> {
  return parse(await apiRequest('/api/v1/me', { auth: true }), accountSchema);
}

export async function updateAccount(input: ProfileUpdate): Promise<AccountView> {
  return parse(
    await apiRequest('/api/v1/me', { method: 'PATCH', body: input, auth: true }),
    accountSchema,
  );
}

export async function logoutCurrentDevice(): Promise<void> {
  const refreshToken = await readRefreshToken();
  try {
    if (refreshToken) {
      await apiRequest('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        auth: false,
      });
    }
  } finally {
    await clearSessionSecrets();
  }
}

export async function logoutEveryDevice(): Promise<void> {
  try {
    await apiRequest('/api/v1/me/logout-all', { method: 'POST', auth: true });
  } finally {
    await clearSessionSecrets();
  }
}

export function verifyEmail(token: string): Promise<unknown> {
  return apiRequest('/api/v1/auth/verify-email', { method: 'POST', body: { token }, auth: false });
}

export function resendVerification(email: string): Promise<unknown> {
  return apiRequest('/api/v1/auth/resend-verification', {
    method: 'POST',
    body: { email },
    auth: false,
  });
}

export function resendCurrentVerification(): Promise<unknown> {
  return apiRequest('/api/v1/me/resend-verification', { method: 'POST', auth: true });
}

export function forgotPassword(email: string): Promise<unknown> {
  return apiRequest('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: { email },
    auth: false,
  });
}

export function resetPassword(token: string, password: string): Promise<unknown> {
  return apiRequest('/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token, password },
    auth: false,
  });
}

export function confirmEmailChange(token: string): Promise<unknown> {
  return apiRequest('/api/v1/auth/confirm-email', { method: 'POST', body: { token }, auth: false });
}

export function changePassword(input: {
  currentPassword?: string;
  newPassword: string;
  reauthentication?: Reauthentication;
}): Promise<unknown> {
  return apiRequest('/api/v1/me/password', { method: 'POST', body: input, auth: true });
}

export function requestEmailChange(
  email: string,
  reauthentication: Reauthentication,
): Promise<unknown> {
  return apiRequest('/api/v1/me/email', {
    method: 'POST',
    body: { email, reauthentication },
    auth: true,
  });
}

export function listSessions(): Promise<{
  sessions: {
    id: string;
    current: boolean;
    createdAt: string;
    lastUsedAt: string;
    expiresAt: string;
    deviceLabel: string | null;
    platform: string | null;
  }[];
}> {
  return apiRequest('/api/v1/me/sessions', { auth: true }).then((body) =>
    sessionListSchema.parse(body),
  );
}

export function revokeSession(sessionId: string): Promise<unknown> {
  return apiRequest(`/api/v1/me/sessions/${sessionId}`, { method: 'DELETE', auth: true });
}

export function linkIdentity(input: unknown): Promise<AccountView> {
  return apiRequest('/api/v1/me/identities/link', { method: 'POST', body: input, auth: true }).then(
    (body) => accountSchema.parse(body),
  );
}

export function unlinkIdentity(
  identityId: string,
  reauthentication: Reauthentication,
): Promise<AccountView> {
  return apiRequest(`/api/v1/me/identities/${identityId}`, {
    method: 'DELETE',
    body: { reauthentication },
    auth: true,
  }).then((body) => accountSchema.parse(body));
}

export function uploadProfilePhoto(
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  dataBase64: string,
): Promise<unknown> {
  return apiRequest('/api/v1/me/photo', {
    method: 'POST',
    body: { contentType, dataBase64 },
    auth: true,
  });
}

export function deleteProfilePhoto(): Promise<unknown> {
  return apiRequest('/api/v1/me/photo', { method: 'DELETE', auth: true });
}

export async function fetchProfilePhoto(): Promise<string | null> {
  const baseUrl = getApiBaseUrl();
  const accessToken = readAccessToken() ?? (await refreshAccessToken());
  if (!baseUrl || !accessToken) {
    return null;
  }
  const response = await fetch(`${baseUrl}/api/v1/me/photo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'image/*' },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw readApiError(response.status, await parseBody(response));
  }
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

export function requestExport(): Promise<{ id: string; status: string }> {
  return apiRequest('/api/v1/me/export', { method: 'POST', auth: true }).then((body) =>
    exportStatusSchema.parse(body),
  );
}

export function readExport(exportId: string): Promise<{ id: string; status: string }> {
  return apiRequest(`/api/v1/me/export/${exportId}`, { auth: true }).then((body) =>
    exportStatusSchema.parse(body),
  );
}

export async function downloadExport(exportId: string): Promise<string> {
  const baseUrl = getApiBaseUrl();
  const accessToken = readAccessToken() ?? (await refreshAccessToken());
  if (!baseUrl || !accessToken) {
    throw new ApiClientError('Entre novamente para continuar.', 401, 'unauthenticated');
  }
  const response = await fetch(`${baseUrl}/api/v1/me/export/${exportId}/download`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
    throw readApiError(response.status, body);
  }
  return text;
}

export function deleteAccount(
  confirmation: string,
  reauthentication: Reauthentication,
): Promise<unknown> {
  return apiRequest('/api/v1/me/delete-account', {
    method: 'POST',
    body: { confirmation, reauthentication },
    auth: true,
  });
}
