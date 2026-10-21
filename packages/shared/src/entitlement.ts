const ENTITLED_STATUSES = new Set(['trialing', 'active', 'grace_period']);

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'grace_period',
  'billing_retry',
  'expired',
  'revoked',
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionSnapshot = {
  id: string;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
};

export type AppAccessEntitlement = {
  feature: 'app_access';
  active: boolean;
  activeUntil: string | null;
  sourceSubscriptionId: string | null;
  source: 'store_subscription' | 'none';
};

function parseInstant(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error('currentPeriodEnd must be an ISO-8601 timestamp.');
  }
  return parsed;
}

export const ACCOUNT_MANAGEMENT_ACTIONS = [
  'read_profile',
  'update_profile',
  'manage_sessions',
  'export_data',
  'delete_account',
  'restore_purchases',
  'view_subscription',
] as const;

export type AccountManagementAction = (typeof ACCOUNT_MANAGEMENT_ACTIONS)[number];

export type AccountManagementAccess = {
  allowed: boolean;
  actions: readonly AccountManagementAction[];
};

/**
 * Account management is authentication and authorization, not a purchase.
 * A missing or expired subscription must not block export, deletion, or profile access.
 */
export function resolveAccountManagement(
  userStatus: 'active' | 'pending_deletion' | 'deleted',
): AccountManagementAccess {
  if (userStatus === 'deleted') {
    return { allowed: false, actions: [] };
  }
  return { allowed: true, actions: ACCOUNT_MANAGEMENT_ACTIONS };
}

/**
 * Commercial training access comes only from a store subscription snapshot.
 * Account age is intentionally not an input: the product must not grant an internal trial.
 * Callers must not use this result as a login gate.
 */
export function resolveAppAccess(
  subscriptions: readonly SubscriptionSnapshot[],
  now: Date,
): AppAccessEntitlement {
  const nowMs = now.getTime();
  const entitled = subscriptions.filter(
    (subscription) =>
      ENTITLED_STATUSES.has(subscription.status) &&
      parseInstant(subscription.currentPeriodEnd) > nowMs,
  );

  if (entitled.length === 0) {
    return {
      feature: 'app_access',
      active: false,
      activeUntil: null,
      sourceSubscriptionId: null,
      source: 'none',
    };
  }

  const best = entitled.reduce((current, candidate) => {
    const currentEnd = parseInstant(current.currentPeriodEnd);
    const candidateEnd = parseInstant(candidate.currentPeriodEnd);
    if (candidateEnd !== currentEnd) {
      return candidateEnd > currentEnd ? candidate : current;
    }
    return candidate.id > current.id ? candidate : current;
  });

  return {
    feature: 'app_access',
    active: true,
    activeUntil: best.currentPeriodEnd,
    sourceSubscriptionId: best.id,
    source: 'store_subscription',
  };
}
