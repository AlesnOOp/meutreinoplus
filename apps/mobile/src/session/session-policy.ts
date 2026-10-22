import {
  decideLocalLogout,
  logoutLocalTargets,
  type AccountView,
  type LocalLogoutReason,
} from '@meutreino/shared';

export type BootstrapPlan = 'restore' | 'signed_out';
export type LocalCleanupAction = 'keep' | 'delete' | 'confirm';

export function planSessionBootstrap(refreshToken: string | null): BootstrapPlan {
  return refreshToken ? 'restore' : 'signed_out';
}

export function shouldClearRefreshToken(reason: 'network' | 'unauthorized' | 'logout'): boolean {
  return reason !== 'network';
}

export function localCleanupPlan(
  userId: string,
  input: { pendingCount: number; discardPending: boolean; reason: LocalLogoutReason },
): {
  action: LocalCleanupAction;
  databaseName: string | null;
  secureKeys: readonly string[];
} {
  const decision = decideLocalLogout(input);
  const targets = logoutLocalTargets(userId);
  const clearSecrets = input.reason !== 'network_loss' && decision.action !== 'confirm';
  return {
    action: decision.action,
    databaseName: decision.action === 'delete' ? targets.databaseName : null,
    secureKeys: clearSecrets ? targets.secureKeys : [],
  };
}

// A cached identity is usable only after an earlier authenticated session on this device.
// HTTP authorization/validation errors must never become offline access.
export function cachedOfflineAccount(
  refreshToken: string | null,
  lastUserId: string | null,
  account: AccountView | null,
  error: unknown,
): AccountView | null {
  const failure = error as { status?: number; code?: string } | null;
  const unavailable =
    failure?.code === 'network_error' ||
    (typeof failure?.status === 'number' && failure.status >= 500);
  return refreshToken &&
    lastUserId &&
    account?.id === lastUserId &&
    account.status === 'active' &&
    unavailable
    ? account
    : null;
}
