const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const shared = require('@meutreino/shared');
const { harness, deferred } = require('./support/sqlite-harness.cjs');

async function prepare(t) {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await h.store.syncSessions(h.user);
  const queue = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE entity_id=?', session.id);
  await h.db.runAsync("UPDATE sync_queue SET status='error' WHERE id=?", queue.id);
  await h.db.runAsync(
    'UPDATE sessions SET conflict_operation_id=?,pending=1,synced=0 WHERE id=?',
    queue.id,
    session.id,
  );
  return { h, session, queue };
}
async function record(h, id) {
  const session = await h.store.readLocalSession(h.user, id);
  return h.store.recordLocalSet(h.user, id, {
    exerciseSessionId: session.exerciseSessions[0].id,
    plannedSetId: null,
    repetitions: 8,
    load: null,
    loadUnit: null,
    outcome: 'completed',
  });
}

test('resolution: keep_remote cannot discard local execution without reviewed confirmation', async (t) => {
  const { h, session } = await prepare(t);
  await record(h, session.id);
  let sent = 0;
  h.api.resolveSessionConflictRequest = async () => {
    sent++;
  };
  await assert.rejects(
    h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_remote'),
    /Revise/,
  );
  assert.equal(sent, 0);
  assert.equal((await h.store.readLocalSession(h.user, session.id)).performedSets.length, 1);
  assert.equal(
    (await h.db.getFirstAsync('SELECT COUNT(*) count FROM session_resolution_intents')).count,
    0,
  );
});

test('resolution: edits between preview and confirmation invalidate the decision before transport', async (t) => {
  const { h, session } = await prepare(t);
  const reviewed = await h.store.previewLocalSessionConflict(h.user, session.id, 'keep_both');
  await record(h, session.id);
  await assert.rejects(
    h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_both', reviewed),
    /mudou/,
  );
  assert.equal(
    (await h.db.getFirstAsync('SELECT COUNT(*) count FROM session_resolution_intents')).count,
    0,
  );
  assert.equal((await h.store.readLocalSession(h.user, session.id)).pending, true);
});

test('resolution: timeout AFTER server commit survives process restart; same request and key retry, preserving later edits', async (t) => {
  const { h, session } = await prepare(t);
  const requests = [];
  const receipts = new Map();
  let fail = true;
  h.api.resolveSessionConflictRequest = async (_id, body) => {
    requests.push(JSON.stringify(body));
    if (!receipts.has(body.idempotencyKey))
      receipts.set(body.idempotencyKey, {
        ...h.sessions.get(session.id),
        version: 2,
        resolution: {
          id: body.idempotencyKey,
          choice: body.choice,
          localRevision: body.localRevision,
        },
      });
    if (fail) {
      fail = false;
      throw new h.errors.ApiClientError('timeout', 0, 'network_error');
    }
    return receipts.get(body.idempotencyKey);
  };
  await assert.rejects(
    h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_local'),
    /timeout/,
  );
  const intent = await h.db.getFirstAsync('SELECT * FROM session_resolution_intents');
  assert.equal(intent.status, 'pending');
  await record(h, session.id);
  const newer = await h.store.readLocalSession(h.user, session.id);
  await h.reopen();
  await h.store.retrySessionResolutions(h.user);
  assert.equal(requests[0], requests[1]);
  assert.equal(receipts.size, 1);
  const result = await h.store.readLocalSession(h.user, session.id);
  assert.deepEqual(result.performedSets, newer.performedSets);
  assert.equal(result.pending, true);
  assert.equal(result.synced, false);
  assert.equal(result.conflictOperationId, null);
  assert.equal(
    (await h.db.getFirstAsync('SELECT status FROM session_resolution_intents')).status,
    'applied',
  );
  const queue = await h.db.getAllAsync("SELECT * FROM sync_queue WHERE status='pending'");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].base_version, 2);
});

test('resolution: SQLite failure after remote ACK rolls back receipt, queue and payload; retry completes once', async (t) => {
  const { h, session, queue } = await prepare(t);
  const original = h.api.resolveSessionConflictRequest;
  let request;
  h.api.resolveSessionConflictRequest = async (id, body) => {
    request = body;
    const response = await original(id, body);
    h.failNextSql(/UPDATE sessions SET acknowledged_revision/);
    return response;
  };
  await assert.rejects(
    h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_both'),
    /Injected SQLite/,
  );
  assert.equal(
    (await h.db.getFirstAsync('SELECT status FROM session_resolution_intents')).status,
    'pending',
  );
  assert.equal(
    (await h.db.getFirstAsync('SELECT status FROM sync_queue WHERE id=?', queue.id)).status,
    'error',
  );
  assert.equal((await h.store.readLocalSession(h.user, session.id)).conflictOperationId, queue.id);
  h.api.resolveSessionConflictRequest = async (id, body) => {
    assert.deepEqual(body, request);
    return original(id, body);
  };
  await h.store.retrySessionResolutions(h.user);
  assert.equal((await h.store.readLocalSession(h.user, session.id)).pending, false);
});

test('resolution: incompatible newer correction is preserved and queued against a stale base for a NEW conflict', async (t) => {
  const { h, session } = await prepare(t);
  await record(h, session.id);
  const gate = deferred(),
    entered = deferred();
  const original = h.api.resolveSessionConflictRequest;
  h.api.resolveSessionConflictRequest = async (id, body) => {
    const response = await original(id, body);
    entered.resolve();
    await gate.promise;
    return { ...response, version: 2 };
  };
  const reviewed = await h.store.previewLocalSessionConflict(h.user, session.id, 'keep_remote');
  const running = h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_remote', reviewed);
  await entered.promise;
  const local = await h.store.readLocalSession(h.user, session.id);
  await h.store.correctLocalSet(h.user, session.id, local.performedSets[0].id, {
    repetitions: 12,
    load: null,
    loadUnit: null,
    voided: false,
    reason: 'Depois da decisão',
  });
  gate.resolve();
  await running;
  const row = await h.store.readLocalSession(h.user, session.id);
  assert.equal(row.corrections.length, 1);
  assert.equal(row.performedSets.length, 1);
  assert.equal(row.pending, true);
  const queued = await h.db.getFirstAsync("SELECT * FROM sync_queue WHERE status='pending'");
  assert.equal(queued.base_version, 1);
  assert.equal(JSON.parse(queued.payload).corrections.length, 1);
});

test('resolution: another device wins; closed conflict cannot trap newer local work or reuse its old key', async (t) => {
  const { h, session } = await prepare(t);
  await record(h, session.id);
  h.api.resolveSessionConflictRequest = async () => {
    throw new h.errors.ApiClientError('Outro aparelho', 409, 'conflict_already_resolved');
  };
  await assert.rejects(
    h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_local'),
    /Outro aparelho/,
  );
  const row = await h.store.readLocalSession(h.user, session.id);
  assert.equal(row.pending, true);
  assert.equal(row.conflictOperationId, null);
  assert.equal(row.performedSets.length, 1);
  assert.equal(
    (await h.db.getFirstAsync('SELECT status FROM session_resolution_intents')).status,
    'requires_review',
  );
  const queued = await h.db.getFirstAsync("SELECT * FROM sync_queue WHERE status='pending'");
  assert.ok(queued);
  assert.equal(queued.base_version, 1);
});

test('resolution: discovering a previously closed conflict in PREVIEW also recovers pending local work', async (t) => {
  const { h, session } = await prepare(t);
  await record(h, session.id);
  h.api.previewSessionConflictRequest = async () => {
    throw new h.errors.ApiClientError('Já resolvido', 409, 'conflict_already_resolved');
  };
  await assert.rejects(
    h.store.previewLocalSessionConflict(h.user, session.id, 'keep_both'),
    /resolvido/,
  );
  assert.equal((await h.store.readLocalSession(h.user, session.id)).conflictOperationId, null);
  assert.equal(
    (await h.db.getFirstAsync("SELECT COUNT(*) count FROM sync_queue WHERE status='pending'"))
      .count,
    1,
  );
});

test('resolution: edits AFTER receipt remain a new pending revision; superseded ACK cannot clear them', async (t) => {
  const { h, session, queue } = await prepare(t);
  await h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_local');
  await record(h, session.id);
  const before = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  await h.load('db/sync-state').acknowledge(h.db, queue);
  const after = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  assert.equal(after.payload, before.payload);
  assert.equal(after.pending, 1);
  assert.equal(after.local_revision, before.local_revision);
});

test('variants: remote and local historical copies persist across restart and do not create another session', async (t) => {
  const { h, session } = await prepare(t);
  h.api.sessionVariantsRequest = async () =>
    ['local', 'remote'].map((origin) => ({
      id: randomUUID(),
      resolutionId: randomUUID(),
      origin,
      choice: 'keep_both',
      sourceRevision: 1,
      createdAt: new Date().toISOString(),
      payload: shared.sessionSyncPayloadSchema.parse(session),
    }));
  await h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_both');
  await h.reopen();
  const copies = await h.store.readSessionVariants(h.user, session.id);
  assert.equal(copies.length, 2);
  assert.deepEqual(new Set(copies.map((row) => row.origin)), new Set(['local', 'remote']));
  assert.equal((await h.db.getFirstAsync('SELECT COUNT(*) count FROM sessions')).count, 1);
});

test('SQLite schema 5→9 migration preserves synced catalog versions instead of repeating schema 4 normalization', async (t) => {
  const { h } = await prepare(t);
  await h.db.runAsync("UPDATE local_meta SET value='5' WHERE key='schema_version'");
  await h.db.runAsync('UPDATE gyms SET version=7,pending=0,synced=1 WHERE id=?', h.gym.id);
  await h.reopen();
  const gym = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(gym.version, 7);
  assert.equal(gym.synced, 1);
  assert.equal(
    (await h.db.getFirstAsync("SELECT value FROM local_meta WHERE key='schema_version'")).value,
    '9',
  );
});

test('feedback: a later offline comment uses the persisted feedback revision while keeping its own text', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await h.store.syncSessions(h.user);
  const exercise = session.exerciseSessions[0].id;
  await h.store.saveLocalFeedback(h.user, session.id, exercise, {
    perceivedLevel: 3,
    comment: 'A',
  });
  const gate = deferred(),
    entered = deferred();
  const push = h.api.pushSessionSync;
  h.api.pushSessionSync = async (ops) => {
    const response = await push(ops);
    const remote = h.sessions.get(session.id);
    remote.payload.feedback.forEach((row) => (row.version = 1));
    entered.resolve();
    await gate.promise;
    return response;
  };
  const running = h.store.syncSessions(h.user);
  await entered.promise;
  await h.store.saveLocalFeedback(h.user, session.id, exercise, {
    perceivedLevel: 5,
    comment: 'B posterior',
  });
  gate.resolve();
  await running;
  const local = await h.store.readLocalSession(h.user, session.id);
  assert.equal(local.feedback[0].comment, 'B posterior');
  assert.equal(local.feedback[0].version, 1);
  assert.equal(local.pending, true);
  const queued = await h.db.getFirstAsync(
    "SELECT * FROM sync_queue WHERE status='pending' AND entity_id=?",
    session.id,
  );
  assert.equal(JSON.parse(queued.payload).feedback[0].comment, 'B posterior');
  assert.equal(JSON.parse(queued.payload).feedback[0].version, 1);
});

test('relogin: an empty SQLite database restores completed history and its persisted feedback', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await h.store.saveLocalFeedback(h.user, session.id, session.exerciseSessions[0].id, {
    perceivedLevel: 5,
    comment: 'Feedback após novo login',
  });
  await h.store.finishLocalSession(h.user, session.id, 'completed', null);
  for (let i = 0; i < 4; i++) await h.store.syncSessions(h.user);
  const stored = h.sessions.get(session.id);
  assert.equal(stored.payload.feedback[0].comment, 'Feedback após novo login');
  // Equivalent session state to logout deleting the device DB: new empty sessions table after reopen.
  await h.db.runAsync('DELETE FROM sessions');
  await h.reopen();
  h.api.listSessionPageRequest = async () => ({
    page: 1,
    pageSize: 50,
    total: 1,
    items: [{ id: session.id, version: stored.version, status: 'completed' }],
  });
  await h.store.syncSessions(h.user);
  const restored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(restored.feedback[0].comment, 'Feedback após novo login');
  assert.equal(restored.status, 'completed');
  assert.equal(restored.pending, false);
});

test('history rehydration cannot overwrite a local edit made while its GET is in flight', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await h.store.syncSessions(h.user);
  const captured = structuredClone(h.sessions.get(session.id));
  captured.version = 9;
  h.api.listSessionPageRequest = async () => ({
    page: 1,
    pageSize: 50,
    total: 1,
    items: [{ id: session.id, version: 9 }],
  });
  const gate = deferred(),
    entered = deferred();
  h.api.getSessionRequest = async () => {
    entered.resolve();
    await gate.promise;
    return captured;
  };
  const running = h.store.syncSessions(h.user);
  await entered.promise;
  await record(h, session.id);
  gate.resolve();
  await running;
  const local = await h.store.readLocalSession(h.user, session.id);
  assert.equal(local.performedSets.length, 1);
  assert.equal(local.pending, true);
});
