import { HttpStatus, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { sha256 } from './crypto';
import { fail } from './http';

export type VerifiedIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
};

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export type OidcConfig = {
  appleAudiences: readonly string[];
  googleClientIds: readonly string[];
  googleWebClientId: string;
  googleClientSecret: string;
  googleRedirectUris: readonly string[];
};

@Injectable()
export class OidcIdentityService {
  constructor(private readonly config: OidcConfig) {}

  verifyApple(identityToken: string, nonce: string): Promise<VerifiedIdentity> {
    if (this.config.appleAudiences.length === 0) {
      throw notConfigured();
    }
    return verifyIdentityJwt(identityToken, {
      jwks: APPLE_JWKS,
      issuer: APPLE_ISSUER,
      audience: [...this.config.appleAudiences],
      nonce,
    });
  }

  async exchangeGoogle(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<VerifiedIdentity> {
    if (
      this.config.googleClientIds.length === 0 ||
      !this.config.googleClientIds.includes(input.clientId) ||
      !this.config.googleRedirectUris.includes(input.redirectUri)
    ) {
      throw notConfigured();
    }

    const body = new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    });
    if (this.config.googleClientSecret && input.clientId === this.config.googleWebClientId) {
      body.set('client_secret', this.config.googleClientSecret);
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'invalid_identity',
        'Não foi possível validar o login do Google.',
      );
    }
    const payload: unknown = await response.json();
    const idToken =
      typeof payload === 'object' && payload !== null && 'id_token' in payload
        ? (payload as { id_token?: unknown }).id_token
        : undefined;
    if (typeof idToken !== 'string') {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'invalid_identity',
        'Não foi possível validar o login do Google.',
      );
    }
    return verifyIdentityJwt(idToken, {
      jwks: GOOGLE_JWKS,
      issuer: GOOGLE_ISSUERS,
      audience: input.clientId,
    });
  }
}

export async function verifyIdentityJwt(
  token: string,
  options: {
    jwks: JWTVerifyGetKey;
    issuer: string | string[];
    audience: string | string[];
    nonce?: string;
  },
): Promise<VerifiedIdentity> {
  try {
    const { payload } = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
    });
    if (options.nonce && !nonceMatches(payload.nonce, options.nonce)) {
      throw new Error('nonce');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('sub');
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null,
      emailVerified: readEmailVerified(payload),
    };
  } catch {
    throw fail(
      HttpStatus.UNAUTHORIZED,
      'invalid_identity',
      'Não foi possível validar a identidade.',
    );
  }
}

function nonceMatches(claim: JWTPayload['nonce'], nonce: string): boolean {
  if (typeof claim !== 'string') {
    return false;
  }
  return claim === nonce || claim === sha256(nonce);
}

function readEmailVerified(payload: JWTPayload): boolean {
  const value = payload.email_verified;
  return value === true || value === 'true';
}

function notConfigured(): never {
  throw fail(
    HttpStatus.SERVICE_UNAVAILABLE,
    'provider_not_configured',
    'Este login ainda não está configurado no servidor.',
  );
}
