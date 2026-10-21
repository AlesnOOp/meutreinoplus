import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyIdentityJwt } from './oidc.service';
import { rangeContains } from './hibp';

describe('breach range matching', () => {
  it('detects a suffix with a positive count and ignores padding', () => {
    const body = 'ABCDEF0123456789ABCDEF0123456789ABCDE:3\n00000000000000000000000000000000000:0\n';
    expect(rangeContains(body, 'ABCDEF0123456789ABCDEF0123456789ABCDE')).toBe(true);
    expect(rangeContains(body, '00000000000000000000000000000000000')).toBe(false);
  });
});

describe('verifyIdentityJwt', () => {
  it('accepts a signed token and rejects the wrong audience or nonce', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwks = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
    const nonce = 'nonce-value-123456';
    const token = await new SignJWT({
      email: 'Ana@Example.com',
      email_verified: true,
      nonce: 'b8e6c1f5a0d24c0a6e5e0c9a7b1d2e3f4a5b6c7d8e9f00112233445566778899',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('apple-subject')
      .setIssuer('https://appleid.apple.com')
      .setAudience('plus.meutreino.app')
      .setExpirationTime('2m')
      .sign(privateKey);

    await expect(
      verifyIdentityJwt(token, {
        jwks,
        issuer: 'https://appleid.apple.com',
        audience: 'plus.meutreino.app',
        nonce,
      }),
    ).rejects.toBeTruthy();

    const { createHash } = await import('node:crypto');
    const nonceHash = createHash('sha256').update(nonce).digest('hex');
    const matching = await new SignJWT({
      email: 'Ana@Example.com',
      email_verified: true,
      nonce: nonceHash,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('apple-subject')
      .setIssuer('https://appleid.apple.com')
      .setAudience('plus.meutreino.app')
      .setExpirationTime('2m')
      .sign(privateKey);

    await expect(
      verifyIdentityJwt(matching, {
        jwks,
        issuer: 'https://appleid.apple.com',
        audience: 'plus.meutreino.app',
        nonce,
      }),
    ).resolves.toEqual({
      sub: 'apple-subject',
      email: 'ana@example.com',
      emailVerified: true,
    });

    await expect(
      verifyIdentityJwt(matching, {
        jwks,
        issuer: 'https://appleid.apple.com',
        audience: 'wrong.audience',
        nonce,
      }),
    ).rejects.toBeTruthy();
  });
});
