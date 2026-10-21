import { describe, expect, it } from 'vitest';
import {
  DELETE_ACCOUNT_CONFIRMATION,
  classifyRefresh,
  decideSocialAccount,
  localDatabaseName,
  logoutLocalTargets,
  normalizeEmail,
  registerSchema,
} from './contracts';

describe('identity contracts', () => {
  it('normalizes e-mail without treating a duplicate as a different address', () => {
    expect(normalizeEmail('  Ana@Example.com ')).toBe('ana@example.com');
  });

  it('accepts a long password and rejects a short one', () => {
    const password = 'a'.repeat(80);
    expect(
      registerSchema.safeParse({
        displayName: 'Ana',
        email: 'ana@example.com',
        password,
        acceptTerms: true,
        acceptPrivacy: true,
      }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({
        displayName: 'Ana',
        email: 'ana@example.com',
        password: 'short',
        acceptTerms: true,
        acceptPrivacy: true,
      }).success,
    ).toBe(false);
  });

  it('isolates the local database and clears only the refresh token on logout', () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    expect(localDatabaseName(userId)).toBe(`meutreino-${userId}.db`);
    expect(logoutLocalTargets(userId).secureKeys).toEqual(['meutreino.refresh_token']);
    expect(() => localDatabaseName('not-a-uuid')).toThrow(/UUID/);
  });

  it('classifies refresh tokens without last-write-wins', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    const session = {
      revokedAt: null,
      replacedById: null,
      expiresAt: '2026-11-20T12:00:00.000Z',
      lastUsedAt: '2026-10-20T11:00:00.000Z',
    };
    expect(classifyRefresh({ session, now, idleMs: 14 * 24 * 60 * 60 * 1000 })).toBe('rotate');
    expect(
      classifyRefresh({ session: { ...session, replacedById: 'next' }, now, idleMs: 1000 }),
    ).toBe('reuse');
    expect(classifyRefresh({ session: null, now, idleMs: 1000 })).toBe('unknown');
    expect(
      classifyRefresh({
        session: { ...session, lastUsedAt: '2026-09-01T12:00:00.000Z' },
        now,
        idleMs: 14 * 24 * 60 * 60 * 1000,
      }),
    ).toBe('expired');
  });

  it('does not link a social identity just because the e-mail matches', () => {
    expect(
      decideSocialAccount({
        subjectOwnerId: null,
        emailOwnerId: 'user-1',
        currentUserId: null,
      }),
    ).toBe('link_required');
    expect(
      decideSocialAccount({
        subjectOwnerId: null,
        emailOwnerId: 'user-2',
        currentUserId: 'user-1',
      }),
    ).toBe('link');
    expect(
      decideSocialAccount({
        subjectOwnerId: 'user-2',
        emailOwnerId: null,
        currentUserId: 'user-1',
      }),
    ).toBe('unavailable');
  });

  it('uses the exact deletion confirmation', () => {
    expect(DELETE_ACCOUNT_CONFIRMATION).toBe('EXCLUIR MINHA CONTA');
  });
});
