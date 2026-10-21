import { describe, expect, it } from 'vitest';
import {
  resolveAccountManagement,
  resolveAppAccess,
  type SubscriptionSnapshot,
} from './entitlement';

const now = new Date('2026-10-20T15:00:00.000Z');

function subscription(overrides: Partial<SubscriptionSnapshot>): SubscriptionSnapshot {
  return {
    id: 'sub-1',
    status: 'active',
    currentPeriodEnd: '2026-11-20T15:00:00.000Z',
    ...overrides,
  };
}

describe('resolveAccountManagement', () => {
  it('allows account access without reading subscription state', () => {
    expect(resolveAccountManagement('active').allowed).toBe(true);
    expect(resolveAccountManagement('pending_deletion').actions).toContain('delete_account');
    expect(resolveAccountManagement('deleted').allowed).toBe(false);
  });
});

describe('resolveAppAccess', () => {
  it('does not entitle an account that has no store subscription', () => {
    expect(resolveAppAccess([], now)).toEqual({
      feature: 'app_access',
      active: false,
      activeUntil: null,
      sourceSubscriptionId: null,
      source: 'none',
    });
  });

  it.each(['trialing', 'active', 'grace_period'] as const)(
    'entitles %s while the period is open',
    (status) => {
      const result = resolveAppAccess([subscription({ status })], now);
      expect(result.active).toBe(true);
      expect(result.source).toBe('store_subscription');
      expect(result.sourceSubscriptionId).toBe('sub-1');
    },
  );

  it.each(['billing_retry', 'expired', 'revoked'] as const)('does not entitle %s', (status) => {
    expect(resolveAppAccess([subscription({ status })], now).active).toBe(false);
  });

  it('does not entitle a status whose period has already ended', () => {
    const result = resolveAppAccess(
      [subscription({ status: 'trialing', currentPeriodEnd: '2026-10-20T14:59:59.000Z' })],
      now,
    );
    expect(result.active).toBe(false);
  });

  it('keeps the subscription that ends later', () => {
    const result = resolveAppAccess(
      [
        subscription({ id: 'early', currentPeriodEnd: '2026-11-01T00:00:00.000Z' }),
        subscription({ id: 'later', currentPeriodEnd: '2027-10-20T00:00:00.000Z' }),
      ],
      now,
    );
    expect(result.sourceSubscriptionId).toBe('later');
    expect(result.activeUntil).toBe('2027-10-20T00:00:00.000Z');
  });

  it('rejects an unreadable period end', () => {
    expect(() => resolveAppAccess([subscription({ currentPeriodEnd: 'tomorrow' })], now)).toThrow(
      /ISO-8601/,
    );
  });
});
