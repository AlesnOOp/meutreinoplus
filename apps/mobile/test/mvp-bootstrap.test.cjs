const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./support/sqlite-harness.cjs');
const { create } = require('zustand');
const { randomUUID } = require('node:crypto');

test('production session bootstrap restores only a previously authenticated cached identity; restart, logout, revocation and recovery', async (t) => {
  let token = 'previous-refresh',
    lastUser = null,
    online = false,
    revoked;
  let account;
  const dependencies = {
    zustand: { create },
    '@/security/secure-store': {
      readRefreshToken: async () => token,
      readLastUserId: async () => lastUser,
      saveLastUserId: async (id) => {
        lastUser = id;
      },
      deleteLastUserId: async () => {
        lastUser = null;
      },
    },
    '@/api/client': {
      restoreSession: async () => {
        if (online) return account;
        throw new h.errors.ApiClientError('no network', 0, 'network_error');
      },
      clearSessionSecrets: async () => {
        token = null;
      },
      logoutCurrentDevice: async () => {},
      logoutEveryDevice: async () => {},
      onSessionRevoked: (fn) => {
        revoked = fn;
      },
    },
  };
  const h = await harness(undefined, false, dependencies);
  t.after(() => h.close());
  account = {
    id: h.user,
    email: 'demo@example.com',
    emailVerified: true,
    status: 'active',
    profile: {
      displayName: 'Demo',
      locale: 'pt-BR',
      weightUnit: 'kg',
      distanceUnit: 'km',
      theme: 'system',
      timeZone: 'America/Sao_Paulo',
      notifyProductEmail: false,
      hasPhoto: false,
    },
    identities: [],
    entitlement: {
      feature: 'app_access',
      active: false,
      activeUntil: null,
      sourceSubscriptionId: null,
      source: 'none',
    },
    accountManagement: { allowed: true },
  };
  let store = h.load('session/session-store').useSessionStore;
  // A token without a cached identity is insufficient.
  await store.getState().bootstrap();
  assert.equal(store.getState().account, null);
  assert.equal(store.getState().status, 'offline');
  online = true;
  await store.getState().bootstrap();
  assert.equal(store.getState().status, 'authenticated');
  assert.equal(lastUser, h.user);
  online = false;
  await h.reopen();
  store = h.load('session/session-store').useSessionStore;
  await store.getState().bootstrap();
  assert.equal(store.getState().status, 'offline');
  assert.equal(store.getState().account.id, h.user);
  // A different last-user identity must never expose this cache.
  lastUser = randomUUID();
  await store.getState().bootstrap();
  assert.equal(store.getState().account, null);
  lastUser = h.user;
  online = true;
  await store.getState().bootstrap();
  assert.equal(store.getState().status, 'authenticated');
  await h.catalog.saveEquipmentPhoto(
    h.user,
    h.gym.id,
    h.equipment.id,
    'image/png',
    'aGVsbG8=',
    false,
  );
  assert.equal(await store.getState().signOut(), 'needs_confirm');
  assert.equal(store.getState().status, 'authenticated');
  assert.equal((await h.catalog.readLocalEquipment(h.user, h.equipment.id)).photoPending, true);
  await store.getState().signOut({ discardPending: true });
  assert.equal(store.getState().status, 'anonymous');
  assert.equal(token, null);
  await h.reopen();
  store = h.load('session/session-store').useSessionStore;
  online = false;
  await store.getState().bootstrap();
  assert.equal(store.getState().status, 'anonymous');
  assert.equal(store.getState().account, null);
  assert.equal(typeof revoked, 'function');
});
