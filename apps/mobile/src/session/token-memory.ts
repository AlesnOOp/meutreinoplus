let accessToken: string | null = null;
let accessExpiresAt = 0;

export function setAccessToken(token: string, expiresAtIso: string): void {
  accessToken = token;
  accessExpiresAt = Date.parse(expiresAtIso) - 30_000;
}

export function readAccessToken(): string | null {
  if (!accessToken || Date.now() >= accessExpiresAt) {
    return null;
  }
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
  accessExpiresAt = 0;
}
