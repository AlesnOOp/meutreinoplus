export type LocalLogoutReason =
  'voluntary' | 'revoked' | 'user_switch' | 'account_deleted' | 'network_loss';

export type LocalDataDecision =
  | { action: 'keep'; reason: 'pending_changes' | 'offline_preserve' }
  | { action: 'delete'; reason: 'synced' | 'discarded' | 'account_deleted' }
  | { action: 'confirm'; reason: 'pending_changes' };

export function decideLocalLogout(input: {
  pendingCount: number;
  discardPending: boolean;
  reason: LocalLogoutReason;
}): LocalDataDecision {
  if (input.reason === 'network_loss') {
    return { action: 'keep', reason: 'offline_preserve' };
  }
  if (input.reason === 'account_deleted') {
    return { action: 'delete', reason: 'account_deleted' };
  }
  if (input.reason === 'revoked' || input.reason === 'user_switch') {
    return input.pendingCount > 0
      ? { action: 'keep', reason: 'pending_changes' }
      : { action: 'delete', reason: 'synced' };
  }
  if (input.pendingCount > 0 && !input.discardPending) {
    return { action: 'confirm', reason: 'pending_changes' };
  }
  if (input.pendingCount > 0) {
    return { action: 'delete', reason: 'discarded' };
  }
  return { action: 'delete', reason: 'synced' };
}
