const assert = require('node:assert/strict');
const test = require('node:test');
const { harness, deferred } = require('./support/sqlite-harness.cjs');

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

test('session: edit after ACK check while stale GET is delayed survives in real SQLite', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  const get = deferred(),
    entered = deferred();
  const originalGet = h.api.getSessionRequest;
  h.api.getSessionRequest = async (id) => {
    const old = await originalGet(id);
    entered.resolve();
    await get.promise;
    return old;
  };
  const running = h.store.syncSessions(h.user);
  await entered.promise;
  await record(h, session.id);
  get.resolve();
  await running;
  const row = await h.store.readLocalSession(h.user, session.id);
  assert.equal(row.performedSets.length, 1);
  assert.equal(row.pending, true);
  assert.equal(
    (
      await h.db.getAllAsync(
        "SELECT * FROM sync_queue WHERE entity_type='workout_session' AND status='pending'",
      )
    ).length,
    1,
  );
});

test('catalog: ACK of A cannot clear B or let stale snapshot replace it in real SQLite', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'A enviada' }, false);
  const ack = deferred(),
    entered = deferred();
  const push = h.api.pushCatalogSync;
  h.api.pushCatalogSync = async (ops) => {
    const result = await push(ops);
    entered.resolve();
    await ack.promise;
    return result;
  };
  const running = h.catalog.syncCatalog(h.user);
  await entered.promise;
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'B posterior' }, false);
  ack.resolve();
  const report = await running;
  const row = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(row.name, 'B posterior');
  assert.equal(row.pending, 1);
  assert.equal(row.synced, 0);
  assert.equal(report.synced, false);
});

async function drainSessions(h) {
  for (let i = 0; i < 20; i++) {
    if (!(await h.db.getFirstAsync('SELECT id FROM sessions WHERE pending=1 LIMIT 1'))) return;
    await h.store.syncSessions(h.user);
  }
  assert.fail('Session queue did not converge');
}

for (const kind of ['set', 'correction', 'feedback', 'pause_resume', 'finish']) {
  test(`session: ACK N and delayed GET preserve N+1/N+2 (${kind}), then converge`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
    await record(h, session.id);
    await drainSessions(h);
    await record(h, session.id); // revision N, now pending
    const ack = deferred(),
      pushed = deferred(),
      get = deferred(),
      requested = deferred();
    const push = h.api.pushSessionSync,
      originalGet = h.api.getSessionRequest;
    h.api.pushSessionSync = async (ops) => {
      const result = await push(ops);
      pushed.resolve();
      await ack.promise;
      return result;
    };
    h.api.getSessionRequest = async (id) => {
      const response = await originalGet(id);
      requested.resolve();
      await get.promise;
      return response;
    };
    const running = h.store.syncSessions(h.user);
    await pushed.promise;
    const before = await h.store.readLocalSession(h.user, session.id);
    if (kind === 'correction')
      await h.store.correctLocalSet(h.user, session.id, before.performedSets[0].id, {
        repetitions: 11,
        load: null,
        loadUnit: null,
        voided: false,
        reason: 'N+1',
      });
    else if (kind === 'feedback')
      await h.store.saveLocalFeedback(h.user, session.id, before.exerciseSessions[0].id, {
        perceivedLevel: 4,
        comment: 'N+1',
      });
    else if (kind === 'pause_resume') await h.store.pushLocalClock(h.user, session.id, 'pause');
    else await record(h, session.id);
    ack.resolve();
    await requested.promise;
    if (kind === 'finish') await h.store.finishLocalSession(h.user, session.id, 'completed', 'N+2');
    else if (kind === 'pause_resume') await h.store.pushLocalClock(h.user, session.id, 'resume');
    else await record(h, session.id);
    const latest = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
    get.resolve();
    const report = await running;
    const after = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
    assert.equal(after.payload, latest.payload);
    assert.equal(after.local_revision, latest.local_revision);
    assert.equal(after.pending, 1);
    assert.equal(after.synced, 0);
    assert.equal(report.synced, false);
    const queue = await h.db.getAllAsync(
      "SELECT * FROM sync_queue WHERE entity_type='workout_session' AND entity_id=? AND status='pending' ORDER BY local_revision",
      session.id,
    );
    assert.equal(queue.length, 2);
    assert.equal(queue.at(-1).local_revision, after.local_revision);
    assert.equal(queue.at(-1).payload, latest.payload);
    assert.ok(after.stale_remote_version >= 1);
    h.api.pushSessionSync = push;
    h.api.getSessionRequest = originalGet;
    await drainSessions(h);
    const final = await h.store.readLocalSession(h.user, session.id);
    assert.equal(final.pending, false);
    assert.equal(final.synced, true);
    assert.equal(JSON.stringify(h.sessions.get(session.id).payload), latest.payload);
  });
}

const catalogCases = [
  {
    name: 'gym name',
    type: 'gym',
    table: 'gyms',
    key: 'gym',
    field: 'name',
    save: (h, name) => h.catalog.saveGym(h.user, { id: h.gym.id, name }, false),
  },
  {
    name: 'equipment name',
    type: 'equipment',
    table: 'equipment',
    key: 'equipment',
    field: 'name',
    save: (h, name) =>
      h.catalog.saveEquipment(
        h.user,
        h.gym.id,
        { id: h.equipment.id, name, exerciseIds: [h.exercise.id] },
        false,
      ),
  },
  {
    name: 'equipment/exercise association',
    type: 'equipment',
    table: 'equipment',
    key: 'equipment',
    field: 'exercise_ids',
    save: (h, name) =>
      h.catalog.saveEquipment(
        h.user,
        h.gym.id,
        {
          id: h.equipment.id,
          name: h.equipment.name,
          exerciseIds: name === 'N' ? [h.exercise.id] : [],
        },
        false,
      ),
  },
  {
    name: 'custom exercise',
    type: 'exercise',
    table: 'exercises',
    key: 'exercise',
    field: 'name_pt',
    save: (h, name) => h.catalog.saveExercise(h.user, { ...h.exercise, namePt: name }, false),
  },
  ...['gym', 'equipment', 'exercise'].map((type) => ({
    name: `archive ${type}`,
    type,
    table: type === 'gym' ? 'gyms' : type === 'exercise' ? 'exercises' : 'equipment',
    key: type,
    field: 'status',
    async save(h, name) {
      if (name !== 'N') {
        if (type === 'gym') await h.catalog.archiveGym(h.user, h.gym.id, false);
        if (type === 'equipment')
          await h.catalog.archiveEquipment(h.user, h.gym.id, h.equipment.id, false);
        if (type === 'exercise') await h.catalog.archiveExercise(h.user, h.exercise.id, false);
      } else if (type === 'gym') await h.catalog.saveGym(h.user, { id: h.gym.id, name }, false);
      else if (type === 'equipment')
        await h.catalog.saveEquipment(
          h.user,
          h.gym.id,
          { id: h.equipment.id, name, exerciseIds: [] },
          false,
        );
      else await h.catalog.saveExercise(h.user, { ...h.exercise, namePt: name }, false);
    },
  })),
];

for (const item of catalogCases) {
  test(`catalog: N+1/N+2 survive ACK and delayed snapshot (${item.name})`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    await item.save(h, 'N');
    const ack = deferred(),
      pushed = deferred(),
      get = deferred(),
      requested = deferred();
    const push = h.api.pushCatalogSync,
      pull = h.api.pullCatalogSnapshot;
    h.api.pushCatalogSync = async (ops) => {
      const response = await push(ops);
      pushed.resolve();
      await ack.promise;
      return response;
    };
    h.api.pullCatalogSnapshot = async () => {
      const old = await pull();
      requested.resolve();
      await get.promise;
      return old;
    };
    const running = h.catalog.syncCatalog(h.user);
    await pushed.promise;
    await item.save(h, 'N+1');
    ack.resolve();
    await requested.promise;
    await item.save(h, 'N+2');
    const latest = await h.db.getFirstAsync(
      `SELECT * FROM ${item.table} WHERE id=?`,
      h[item.key].id,
    );
    get.resolve();
    const report = await running;
    const after = await h.db.getFirstAsync(
      `SELECT * FROM ${item.table} WHERE id=?`,
      h[item.key].id,
    );
    assert.equal(after[item.field], latest[item.field]);
    assert.equal(after.local_revision, latest.local_revision);
    assert.equal(after.pending, 1);
    assert.equal(after.synced, 0);
    assert.equal(report.synced, false);
    const queue = await h.db.getAllAsync(
      "SELECT * FROM sync_queue WHERE entity_type=? AND entity_id=? AND status='pending' ORDER BY local_revision",
      item.type,
      h[item.key].id,
    );
    assert.equal(queue.length, 2);
    assert.equal(queue.at(-1).local_revision, after.local_revision);
    h.api.pushCatalogSync = push;
    h.api.pullCatalogSnapshot = pull;
    await h.catalog.syncCatalog(h.user);
    await h.catalog.syncCatalog(h.user);
    const final = await h.db.getFirstAsync(
      `SELECT * FROM ${item.table} WHERE id=?`,
      h[item.key].id,
    );
    assert.equal(final.pending, 0);
    assert.equal(final.synced, 1);
    assert.equal(final[item.field], latest[item.field]);
  });
}

for (const domain of ['catalog', 'sessions']) {
  test(`${domain}: concurrent sync calls share a single transport, local writes remain available`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    let session;
    if (domain === 'sessions')
      session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N' }, false);
    const gate = deferred(),
      entered = deferred();
    let calls = 0;
    const name = domain === 'sessions' ? 'pushSessionSync' : 'pushCatalogSync';
    const push = h.api[name];
    h.api[name] = async (ops) => {
      calls++;
      entered.resolve();
      await gate.promise;
      return push(ops);
    };
    const sync = () =>
      domain === 'sessions' ? h.store.syncSessions(h.user) : h.catalog.syncCatalog(h.user);
    const first = sync();
    await entered.promise;
    const second = sync();
    if (domain === 'sessions') await record(h, session.id);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N+1' }, false);
    assert.equal(calls, 1);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
  });

  test(`${domain}: timeout preserves key; retry and newer revision converge without duplication`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    let session;
    if (domain === 'sessions')
      session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N' }, false);
    const name = domain === 'sessions' ? 'pushSessionSync' : 'pushCatalogSync';
    const push = h.api[name];
    const type = domain === 'sessions' ? 'workout_session' : 'gym';
    const sync = () =>
      domain === 'sessions' ? h.store.syncSessions(h.user) : h.catalog.syncCatalog(h.user);
    let failed = false;
    h.api[name] = async (ops) => {
      const response = await push(ops);
      if (!failed) {
        failed = true;
        throw new h.errors.ApiClientError('timeout', 0, 'network_error');
      }
      return response;
    };
    const original = await h.db.getFirstAsync(
      "SELECT * FROM sync_queue WHERE entity_type=? AND status='pending'",
      type,
    );
    assert.equal((await sync()).synced, false);
    const retry = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE id=?', original.id);
    assert.equal(retry.status, 'pending');
    assert.equal(retry.idempotency_key, original.idempotency_key);
    if (domain === 'sessions') await record(h, session.id);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N+1' }, false);
    await sync();
    await sync();
    const done = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE id=?', original.id);
    assert.equal(done.status, 'done');
    assert.equal(done.attempt_count, 2);
    const latest = await h.db.getFirstAsync(
      `SELECT * FROM ${domain === 'sessions' ? 'sessions' : 'gyms'} WHERE id=?`,
      session?.id ?? h.gym.id,
    );
    assert.equal(latest.pending, 0);
    assert.equal(h.receipts.size, 2);
  });

  test(`${domain}: SQLite error during ACK rolls back both queue and entity, then retry succeeds`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    if (domain === 'sessions') await h.store.startLocalSession(h.user, h.plan.id, null, false);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N' }, false);
    const sync = () =>
      domain === 'sessions' ? h.store.syncSessions(h.user) : h.catalog.syncCatalog(h.user);
    h.failNextSql(/acknowledged_revision = MAX/);
    await assert.rejects(sync, /Injected SQLite write failure/);
    const type = domain === 'sessions' ? 'workout_session' : 'gym';
    const row = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE entity_type=?', type);
    assert.equal(row.status, 'pending');
    await sync();
    assert.equal(h.receipts.size, 1);
    assert.equal(
      (await h.db.getFirstAsync('SELECT status FROM sync_queue WHERE id=?', row.id)).status,
      'done',
    );
  });
}

test('catalog: inverted ACKs cannot roll back revision, server version or local payload', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N' }, false);
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'N+1' }, false);
  const rows = await h.db.getAllAsync(
    "SELECT * FROM sync_queue WHERE entity_type='gym' ORDER BY local_revision",
  );
  const safety = h.load('db/sync-state');
  await safety.acknowledge(h.db, { ...rows[1], base_version: 2 });
  assert.equal(
    (await h.db.getFirstAsync('SELECT pending FROM gyms WHERE id=?', h.gym.id)).pending,
    1,
  );
  await safety.acknowledge(h.db, rows[0]);
  await safety.localTransaction(h.db, async (tx) => {
    assert.equal(await safety.canApplyRemote(tx, 'gym', h.gym.id, 2, 2), false);
  });
  const row = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(row.name, 'N+1');
  assert.equal(row.acknowledged_revision, 2);
  assert.equal(row.version, 3);
});

test('catalog: refresh with no pending work applies remote changes; dirty rows survive omission', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  h.remote.gyms[0] = { ...h.gym, name: 'Remote', version: 2 };
  await h.catalog.syncCatalog(h.user);
  assert.equal((await h.catalog.readLocalGym(h.user, h.gym.id)).name, 'Remote');
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Local' }, false);
  h.api.pushCatalogSync = async () => ({ results: [] });
  h.remote.gyms = [];
  const report = await h.catalog.syncCatalog(h.user);
  assert.equal((await h.catalog.readLocalGym(h.user, h.gym.id)).name, 'Local');
  assert.equal(report.synced, false);
});

test('catalog: entity and queue insertion roll back together on a SQLite failure', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const before = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  h.failNextSql(/INSERT INTO sync_queue/);
  await assert.rejects(
    () => h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Must roll back' }, false),
    /Injected SQLite write failure/,
  );
  const after = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.deepEqual(after, before);
  assert.equal((await h.db.getAllAsync('SELECT * FROM sync_queue')).length, 0);
});

for (const domain of ['catalog', 'sessions']) {
  test(`${domain}: reopen after durable ACK and before refresh preserves data and next edit`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    let id = h.gym.id;
    if (domain === 'sessions') {
      const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
      id = session.id;
    } else await h.catalog.saveGym(h.user, { id, name: 'Before reopen' }, false);
    const name = domain === 'sessions' ? 'getSessionRequest' : 'pullCatalogSnapshot';
    const original = h.api[name];
    h.api[name] = async () => {
      throw new h.errors.ApiClientError('Interrupted before refresh', 0, 'network_error');
    };
    if (domain === 'sessions') await h.store.syncSessions(h.user);
    else await h.catalog.syncCatalog(h.user);
    const table = domain === 'sessions' ? 'sessions' : 'gyms';
    const before = await h.db.getFirstAsync(`SELECT * FROM ${table} WHERE id=?`, id);
    assert.equal(before.acknowledged_revision, before.local_revision);
    await h.reopen();
    const reopened = await h.db.getFirstAsync(`SELECT * FROM ${table} WHERE id=?`, id);
    assert.deepEqual(reopened, before);
    h.api[name] = original;
    if (domain === 'sessions') {
      await record(h, id);
      await drainSessions(h);
    } else {
      await h.catalog.saveGym(h.user, { id, name: 'After reopen' }, false);
      await h.catalog.syncCatalog(h.user);
    }
    const after = await h.db.getFirstAsync(`SELECT * FROM ${table} WHERE id=?`, id);
    assert.equal(after.local_revision, before.local_revision + 1);
    assert.equal(after.pending, 0);
    if (domain === 'sessions') assert.equal(JSON.parse(after.payload).performedSets.length, 1);
    else assert.equal(after.name, 'After reopen');
  });

  test(`${domain}: reopen recovers in-flight operation with same idempotency key`, async (t) => {
    const h = await harness();
    t.after(() => h.close());
    if (domain === 'sessions') await h.store.startLocalSession(h.user, h.plan.id, null, false);
    else await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Interrupted' }, false);
    const type = domain === 'sessions' ? 'workout_session' : 'gym';
    const safety = h.load('db/sync-state');
    const [claimed] = await safety.claimOperations(h.db, [type]);
    // The server processed it, but the process ended before receiving its ACK.
    const operation = {
      id: claimed.id,
      entityId: claimed.entity_id,
      idempotencyKey: claimed.idempotency_key,
      payload: JSON.parse(claimed.payload),
      entityType: type,
    };
    if (domain === 'sessions') await h.api.pushSessionSync([operation]);
    else await h.api.pushCatalogSync([operation]);
    await h.reopen();
    const recovered = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE id=?', claimed.id);
    assert.equal(recovered.status, 'pending');
    assert.equal(recovered.idempotency_key, claimed.idempotency_key);
    if (domain === 'sessions') await h.store.syncSessions(h.user);
    else await h.catalog.syncCatalog(h.user);
    assert.equal(h.receipts.size, 1);
    assert.equal(
      (await h.db.getFirstAsync('SELECT status FROM sync_queue WHERE id=?', claimed.id)).status,
      'done',
    );
  });
}

test('SQLite v4 migration keeps legacy queue and dirty newer row, then converges', async (t) => {
  const h = await harness(undefined, true);
  t.after(() => h.close());
  const row = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(row.name, 'Legacy B');
  assert.equal(row.pending, 1);
  assert.equal(row.synced, 0);
  assert.equal(
    (await h.db.getFirstAsync("SELECT value FROM local_meta WHERE key='schema_version'")).value,
    '5',
  );
  const queued = await h.db.getAllAsync(
    "SELECT * FROM sync_queue WHERE entity_type='gym' ORDER BY rowid",
  );
  assert.equal(queued.length, 2);
  assert.equal(queued[0].local_revision, 0);
  assert.equal(queued[0].status, 'done');
  assert.equal(queued[1].local_revision, 1);
  assert.equal(queued[1].status, 'pending');
  assert.equal(queued[1].base_version, 2);
  await h.catalog.syncCatalog(h.user);
  const done = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(done.name, 'Legacy B');
  assert.equal(done.pending, 0);
  assert.equal(done.acknowledged_revision, 1);
});

test('session: local payload and queue insertion roll back together', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  const before = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  const queue = await h.db.getAllAsync('SELECT * FROM sync_queue ORDER BY rowid');
  h.failNextSql(/INSERT INTO sync_queue/);
  await assert.rejects(() => record(h, session.id), /Injected SQLite write failure/);
  assert.deepEqual(
    await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id),
    before,
  );
  assert.deepEqual(await h.db.getAllAsync('SELECT * FROM sync_queue ORDER BY rowid'), queue);
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Expected durable SQLite write did not occur');
}

test('catalog: concurrent ONLINE saves persist first and cannot be overwritten by an older response', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const gate = deferred(),
    entered = deferred();
  const push = h.api.pushCatalogSync;
  h.api.pushCatalogSync = async (ops) => {
    const response = await push(ops);
    entered.resolve();
    await gate.promise;
    return response;
  };
  const first = h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Online A' }, true);
  await entered.promise;
  const second = h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Online B' }, true);
  await waitFor(
    async () =>
      (await h.db.getFirstAsync('SELECT name FROM gyms WHERE id=?', h.gym.id)).name === 'Online B',
  );
  gate.resolve();
  await Promise.all([first, second]);
  const row = await h.db.getFirstAsync('SELECT * FROM gyms WHERE id=?', h.gym.id);
  assert.equal(row.name, 'Online B');
  assert.equal(row.pending, 1);
  assert.equal(row.synced, 0);
  h.api.pushCatalogSync = push;
  await h.catalog.syncCatalog(h.user);
  assert.equal(h.remote.gyms[0].name, 'Online B');
});

test('session: reversed ACKs and lower remote server version preserve current payload', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await record(h, session.id);
  const rows = await h.db.getAllAsync(
    "SELECT * FROM sync_queue WHERE entity_type='workout_session' ORDER BY local_revision",
  );
  const safety = h.load('db/sync-state');
  await safety.acknowledge(h.db, { ...rows[1], base_version: 1 });
  await safety.acknowledge(h.db, rows[0]);
  await safety.localTransaction(h.db, async (tx) => {
    assert.equal(await safety.canApplyRemote(tx, 'workout_session', session.id, 2, 1), false);
  });
  const row = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  assert.equal(JSON.parse(row.payload).performedSets.length, 1);
  assert.equal(row.server_version, 2);
  assert.equal(row.acknowledged_revision, 2);
});

test('session: open-session refresh rechecks revision after network response', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await drainSessions(h);
  const gate = deferred(),
    entered = deferred();
  h.api.openSessionRequest = async () => {
    const old = JSON.parse(JSON.stringify(h.sessions.get(session.id)));
    entered.resolve();
    await gate.promise;
    return { session: old };
  };
  const running = h.store.syncSessions(h.user);
  await entered.promise;
  await record(h, session.id);
  gate.resolve();
  const result = await running;
  assert.equal((await h.store.readLocalSession(h.user, session.id)).performedSets.length, 1);
  assert.equal(result.synced, false);
});

test('session: initial online start response cannot erase edits made while waiting', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const gate = deferred(),
    entered = deferred();
  h.api.startSessionRequest = async ({ id }) => {
    const row = await h.db.getFirstAsync('SELECT payload FROM sessions WHERE id=?', id);
    const response = { payload: JSON.parse(row.payload), version: 1 };
    h.sessions.set(id, response);
    entered.resolve(id);
    await gate.promise;
    return response;
  };
  const running = h.store.startLocalSession(h.user, h.plan.id, null, true);
  const id = await entered.promise;
  await record(h, id);
  gate.resolve();
  const result = await running;
  assert.equal(result.performedSets.length, 1);
  assert.equal(result.pending, true);
  assert.ok(
    (
      await h.db.getAllAsync(
        "SELECT id FROM sync_queue WHERE entity_type='workout_session' AND status='pending'",
      )
    ).length > 0,
  );
});

test('session: concurrent local edits are serialized only inside SQLite and all survive', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await Promise.all([
    record(h, session.id),
    record(h, session.id),
    h.store.saveLocalFeedback(h.user, session.id, session.exerciseSessions[0].id, {
      perceivedLevel: 5,
      comment: 'Concurrent',
    }),
  ]);
  const row = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  const payload = JSON.parse(row.payload);
  assert.equal(payload.performedSets.length, 2);
  assert.equal(payload.feedback.length, 1);
  assert.equal(row.local_revision, 4);
  assert.deepEqual(
    payload.performedSets.map((item) => item.setIndex),
    [1, 2],
  );
});

test('plans: existing local plan and planned-set CRUD still persist in SQLite', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const plans = h.load('plans/plan-store');
  const plan = await plans.createLocalPlan(h.user, {
    name: 'Regression',
    description: null,
    accent: null,
  });
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.exercises.push({
      id: require('node:crypto').randomUUID(),
      exerciseId: h.exercise.id,
      orderIndex: 1,
      restSeconds: null,
      notes: null,
      equipment: [],
      sets: [{ ...plans.emptyPlanSet(), repetitions: 8 }],
    });
  });
  const saved = await plans.readLocalPlan(h.user, plan.id);
  assert.equal(saved.exercises[0].sets[0].repetitions, 8);
  const copy = await plans.duplicateLocalPlan(h.user, plan.id);
  assert.notEqual(copy.exercises[0].id, saved.exercises[0].id);
  assert.notEqual(copy.exercises[0].sets[0].id, saved.exercises[0].sets[0].id);
});

test('session: edits during conflict resolution remain explicitly pending (Achado 04 not silently cleared)', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  await drainSessions(h);
  const queue = await h.db.getFirstAsync(
    "SELECT * FROM sync_queue WHERE entity_type='workout_session' ORDER BY rowid DESC LIMIT 1",
  );
  await h.db.runAsync(
    "UPDATE sync_queue SET status='error', last_error='version_mismatch' WHERE id=?",
    queue.id,
  );
  await h.db.runAsync(
    'UPDATE sessions SET conflict_operation_id=?,pending=1,synced=0 WHERE id=?',
    queue.id,
    session.id,
  );
  const gate = deferred(),
    entered = deferred();
  h.api.resolveSessionConflictRequest = async () => {
    const response = JSON.parse(JSON.stringify(h.sessions.get(session.id)));
    entered.resolve();
    await gate.promise;
    return response;
  };
  const running = h.store.resolveLocalSessionConflict(h.user, session.id, 'keep_local');
  await entered.promise;
  await record(h, session.id);
  const before = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  gate.resolve();
  await running;
  const after = await h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
  assert.equal(after.payload, before.payload);
  assert.equal(after.pending, 1);
  assert.equal(after.synced, 0);
  assert.equal(after.conflict_operation_id, queue.id);
  assert.equal(
    (await h.db.getFirstAsync('SELECT status FROM sync_queue WHERE id=?', queue.id)).status,
    'error',
  );
});

test('session sync report stays pending when catalog is edited during session transport', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  await h.store.startLocalSession(h.user, h.plan.id, null, false);
  const gate = deferred(),
    entered = deferred();
  const push = h.api.pushSessionSync;
  h.api.pushSessionSync = async (ops) => {
    const reply = await push(ops);
    entered.resolve();
    await gate.promise;
    return reply;
  };
  const running = h.store.syncSessions(h.user);
  await entered.promise;
  await h.catalog.saveGym(h.user, { id: h.gym.id, name: 'Still pending' }, false);
  gate.resolve();
  const result = await running;
  assert.equal(result.synced, false);
  assert.equal(
    (await h.db.getFirstAsync('SELECT pending FROM gyms WHERE id=?', h.gym.id)).pending,
    1,
  );
});
