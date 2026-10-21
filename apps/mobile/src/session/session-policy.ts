import { decideLocalLogout, logoutLocalTargets, type LocalLogoutReason } from '@meutreino/shared';

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
