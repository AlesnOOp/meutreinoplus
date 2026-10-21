import { describe, expect, it } from 'vitest';
import { decideLocalLogout } from './logout-policy';

describe('decideLocalLogout', () => {
  it('asks before discarding pending local changes on voluntary logout', () => {
    expect(
      decideLocalLogout({ pendingCount: 2, discardPending: false, reason: 'voluntary' }),
    ).toEqual({
      action: 'confirm',
      reason: 'pending_changes',
    });
  });

  it('deletes the local database only after the person discards pending changes', () => {
    expect(
      decideLocalLogout({ pendingCount: 2, discardPending: true, reason: 'voluntary' }),
    ).toEqual({
      action: 'delete',
      reason: 'discarded',
    });
  });

  it('keeps pending changes when the session is revoked or the network drops', () => {
    expect(
      decideLocalLogout({ pendingCount: 1, discardPending: false, reason: 'revoked' }).action,
    ).toBe('keep');
    expect(
      decideLocalLogout({ pendingCount: 1, discardPending: false, reason: 'network_loss' }),
    ).toEqual({
      action: 'keep',
      reason: 'offline_preserve',
    });
  });

  it('removes a synced database on logout and always removes it after account deletion', () => {
    expect(
      decideLocalLogout({ pendingCount: 0, discardPending: false, reason: 'voluntary' }),
    ).toEqual({
      action: 'delete',
      reason: 'synced',
    });
    expect(
      decideLocalLogout({ pendingCount: 3, discardPending: false, reason: 'account_deleted' }),
    ).toEqual({
      action: 'delete',
      reason: 'account_deleted',
    });
  });
});
