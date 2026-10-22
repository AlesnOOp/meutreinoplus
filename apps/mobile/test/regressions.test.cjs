const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production modules with device/network boundaries replaced.
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '../src', relative);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    code,
    {
      exports: module.exports,
      module,
      require: (name) => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        throw new Error(`Unexpected import: ${name}`);
      },
      fetch: mocks.fetch,
      setInterval: mocks.setInterval,
      clearInterval: mocks.clearInterval,
    },
    { filename },
  );
  return module.exports;
}

class ApiClientError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

for (const status of [429, 500, 503, 401]) {
  test(`refresh HTTP ${status} ${status === 401 ? 'revokes' : 'preserves'} credentials`, async () => {
    let deleted = 0;
    let revoked = 0;
    const client = load('api/client.ts', {
      '@meutreino/shared': {},
      '@/api/health': { getApiBaseUrl: () => 'https://example.test' },
      '@/api/errors': {
        ApiClientError,
        readApiError: (value) => new ApiClientError('failure', value, 'request_failed'),
      },
      '@/security/secure-store': {
        readRefreshToken: async () => (deleted ? null : 'saved-refresh'),
        deleteRefreshToken: async () => {
          deleted++;
        },
      },
      '@/session/token-memory': { readAccessToken: () => null, clearAccessToken: () => {} },
      fetch: async () => ({ status, ok: false, text: async () => '{}' }),
    });
    client.onSessionRevoked(() => revoked++);
    await assert.rejects(client.restoreSession());
    assert.equal(deleted, status === 401 ? 1 : 0);
    assert.equal(revoked, status === 401 ? 1 : 0);
  });
}

for (const choice of ['keep_server', 'keep_local', 'keep_both']) {
  test(`conflict ${choice} stores server corrections without requeuing stale data (real SQLite)`, async (t) => {
    const { harness } = require('./support/sqlite-harness.cjs');
    const h = await harness();
    t.after(() => h.close());
    const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
    await h.store.syncSessions(h.user);
    const queue = await h.db.getFirstAsync(
      'SELECT * FROM sync_queue WHERE entity_id=?',
      session.id,
    );
    await h.db.runAsync(
      'UPDATE sessions SET conflict_operation_id=?,pending=1,synced=0 WHERE id=?',
      queue.id,
      session.id,
    );
    const reviewed = await h.store.previewLocalSessionConflict(h.user, session.id, choice);
    await h.store.resolveLocalSessionConflict(h.user, session.id, choice, reviewed);
    const saved = await h.store.readLocalSession(h.user, session.id);
    assert.equal(saved.conflictOperationId, null);
    assert.equal(saved.pending, false);
    assert.equal(
      (
        await h.db.getFirstAsync(
          "SELECT COUNT(*) count FROM sync_queue WHERE entity_id=? AND status IN ('pending','error','in_flight')",
          session.id,
        )
      ).count,
      0,
    );
  });
}

test('offline recovery retries in foreground and on resume, then removes listeners', async () => {
  let state = {
    status: 'offline',
    bootstrap: async () => {
      attempts++;
    },
  };
  let attempts = 0;
  let callback;
  let listener;
  let cleanup;
  let removed = false;
  let cleared = false;
  const appState = {
    currentState: 'active',
    addEventListener: (_event, value) => {
      listener = value;
      return {
        remove: () => {
          removed = true;
        },
      };
    },
  };
  const sessionStore = (select) => select(state);
  sessionStore.getState = () => state;
  const RootLayout = load('app/_layout.tsx', {
    '@tanstack/react-query': { QueryClient: class {}, QueryClientProvider: 'Provider' },
    'expo-router': { Stack: 'Stack' },
    'expo-splash-screen': { preventAutoHideAsync: async () => {}, hideAsync: async () => {} },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    react: {
      useEffect: (effect) => {
        cleanup = effect();
      },
    },
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'react-native': { AppState: appState, useColorScheme: () => 'light' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    '@/session/session-store': { useSessionStore: sessionStore },
    '@/state/theme-store': { useThemeStore: () => 'light' },
    '@/theme/colors': { palettes: { light: { background: 'white' } } },
    '@/theme/scheme': { resolveColorScheme: () => 'light' },
    setInterval: (value) => {
      callback = value;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  }).default;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  RootLayout();
  await settle();
  assert.equal(attempts, 1);
  callback();
  await settle();
  assert.equal(attempts, 2);
  appState.currentState = 'background';
  callback();
  await settle();
  assert.equal(attempts, 2);
  appState.currentState = 'active';
  listener('active');
  await settle();
  assert.equal(attempts, 3);
  state = { ...state, status: 'authenticated' };
  callback();
  await settle();
  assert.equal(attempts, 3);
  cleanup();
  assert.equal(removed, true);
  assert.equal(cleared, true);
});
