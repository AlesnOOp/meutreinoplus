import assert from 'node:assert/strict';
import test from 'node:test';
import {
  localCleanupPlan,
  planSessionBootstrap,
  shouldClearRefreshToken,
} from './session-policy.ts';

const userId = '11111111-1111-4111-8111-111111111111';

test('restores a session only when a refresh token exists', () => {
  assert.equal(planSessionBootstrap(null), 'signed_out');
  assert.equal(planSessionBootstrap('refresh-token-value'), 'restore');
});

test('keeps the refresh token when the network fails', () => {
  assert.equal(shouldClearRefreshToken('network'), false);
  assert.equal(shouldClearRefreshToken('unauthorized'), true);
  assert.equal(shouldClearRefreshToken('logout'), true);
});

test('does not delete a local database that still has pending work', () => {
  const voluntary = localCleanupPlan(userId, {
    pendingCount: 2,
    discardPending: false,
    reason: 'voluntary',
  });
  assert.equal(voluntary.action, 'confirm');
  assert.equal(voluntary.databaseName, null);
  assert.deepEqual(voluntary.secureKeys, []);

  const revoked = localCleanupPlan(userId, {
    pendingCount: 2,
    discardPending: false,
    reason: 'revoked',
  });
  assert.equal(revoked.action, 'keep');
  assert.equal(revoked.databaseName, null);
  assert.deepEqual(revoked.secureKeys, ['meutreino.refresh_token']);

  const offline = localCleanupPlan(userId, {
    pendingCount: 2,
    discardPending: false,
    reason: 'network_loss',
  });
  assert.equal(offline.action, 'keep');
  assert.deepEqual(offline.secureKeys, []);

  const discarded = localCleanupPlan(userId, {
    pendingCount: 2,
    discardPending: true,
    reason: 'voluntary',
  });
  assert.equal(discarded.databaseName, `meutreino-${userId}.db`);

  const deletedAccount = localCleanupPlan(userId, {
    pendingCount: 2,
    discardPending: false,
    reason: 'account_deleted',
  });
  assert.equal(deletedAccount.databaseName, `meutreino-${userId}.db`);

  const synced = localCleanupPlan(userId, {
    pendingCount: 0,
    discardPending: false,
    reason: 'voluntary',
  });
  assert.equal(synced.databaseName, `meutreino-${userId}.db`);
  assert.notEqual(
    localCleanupPlan('22222222-2222-4222-8222-222222222222', {
      pendingCount: 0,
      discardPending: false,
      reason: 'user_switch',
    }).databaseName,
    synced.databaseName,
  );
});

test('offline identity requires a token, matching cached user and a transient failure', async () => {
  const { cachedOfflineAccount } = await import('./session-policy.ts');
  const account = { id: userId, status: 'active' } as import('@meutreino/shared').AccountView;
  const network = { status: 0, code: 'network_error' };
  assert.equal(cachedOfflineAccount('token', userId, account, network), account);
  assert.equal(cachedOfflineAccount(null, userId, account, network), null);
  assert.equal(cachedOfflineAccount('token', null, account, network), null);
  assert.equal(cachedOfflineAccount('token', 'other', account, network), null);
  assert.equal(cachedOfflineAccount('token', userId, null, network), null);
  for (const status of [400, 401, 403, 404]) {
    assert.equal(
      cachedOfflineAccount('token', userId, account, { status, code: 'request_failed' }),
      null,
    );
  }
  assert.equal(cachedOfflineAccount('token', userId, account, new Error('invalid data')), null);
});
