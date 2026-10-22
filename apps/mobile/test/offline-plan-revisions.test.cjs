const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, deferred } = require('./support/sqlite-harness.cjs');
async function setup(t) {
  const h = await harness();
  t.after(() => h.close());
  const plans = h.load('plans/plan-store');
  const plan = await plans.createLocalPlan(h.user, {
    name: 'A original',
    description: null,
    accent: null,
  });
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.exercises.push({
      ...h.plan.exercises[0],
      sets: [{ ...plans.emptyPlanSet(), repetitions: 8 }],
    });
  });
  return { h, plans, plan };
}
async function begin(h, plan) {
  const session = await h.store.startLocalSession(h.user, plan.id, null, false);
  await h.store.recordLocalSet(h.user, session.id, {
    exerciseSessionId: session.exerciseSessions[0].id,
    plannedSetId: session.planSnapshot.exercises[0].sets[0].id,
    repetitions: 8,
    load: null,
    loadUnit: null,
    outcome: 'completed',
  });
  return session;
}
test('offline A→T→B: restores the original revision after restart, then sends T without replacing its frozen prescription', async (t) => {
  const { h, plans, plan } = await setup(t);
  const session = await begin(h, plan);
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.name = 'B posterior';
    draft.exercises[0].sets[0].repetitions = 12;
  });
  await h.reopen();
  const result = await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(result.synced, true);
  assert.equal(stored.pending, false);
  assert.equal(stored.planSnapshot.exercises[0].sets[0].repetitions, 8);
  assert.equal(stored.planVersion, 2);
  assert.equal(stored.planSnapshot.version, 2);
  assert.equal(h.remotePlans.get(plan.id).version, 3);
  assert.equal(h.remotePlans.get(plan.id).exercises[0].sets[0].repetitions, 12);
  const originals = await h.db.getAllAsync(
    'SELECT * FROM local_plan_revisions WHERE plan_id=? ORDER BY local_revision',
    plan.id,
  );
  assert.equal(originals.length, 3);
  assert.deepEqual(
    originals.map((row) => row.server_version),
    [1, 2, 3],
  );
  assert.equal(stored.performedSets.length, 1);
  assert.equal((await h.db.getFirstAsync('SELECT COUNT(*) count FROM sessions')).count, 1);
});
test('offline unchanged A binds both version fields to the SAME official revision', async (t) => {
  const { h, plan } = await setup(t);
  const session = await begin(h, plan);
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.planVersion, 2);
  assert.equal(stored.planSnapshot.version, 2);
  assert.equal(stored.pending, false);
});
test('lost plan ACK retries the identical origin/key and creates no second server revision', async (t) => {
  const { h, plan } = await setup(t);
  const session = await begin(h, plan);
  const push = h.api.pushCatalogSync;
  const keys = [];
  let lost = true;
  h.api.pushCatalogSync = async (ops) => {
    keys.push(
      ...ops
        .filter((op) => op.entityType === 'workout_plan')
        .map((op) => ({ key: op.idempotencyKey, payload: op.payload })),
    );
    const response = await push(ops);
    if (lost && ops.some((op) => op.entityType === 'workout_plan')) {
      lost = false;
      throw new h.errors.ApiClientError('timeout', 0, 'network_error');
    }
    return response;
  };
  const first = await h.store.syncSessions(h.user);
  assert.equal(first.synced, false);
  await h.reopen();
  await h.store.syncSessions(h.user);
  assert.deepEqual(keys[0], keys[1]);
  assert.equal(h.remotePlans.get(plan.id).version, 2);
  assert.equal((await h.store.readLocalSession(h.user, session.id)).pending, false);
});
test('plan edit during ACK remains pending and cannot be replaced by an older plan list', async (t) => {
  const { h, plans, plan } = await setup(t);
  const gate = deferred(),
    entered = deferred();
  const push = h.api.pushCatalogSync;
  h.api.pushCatalogSync = async (ops) => {
    const result = await push(ops);
    if (ops.some((op) => op.entityType === 'workout_plan')) {
      entered.resolve();
      await gate.promise;
    }
    return result;
  };
  const running = plans.syncPlans(h.user);
  await entered.promise;
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.name = 'Editada durante rede';
  });
  gate.resolve();
  await running;
  const local = await plans.readLocalPlan(h.user, plan.id);
  assert.equal(local.name, 'Editada durante rede');
  assert.equal(h.remotePlans.get(plan.id).name, 'Editada durante rede');
});
test('SQLite rollback prevents a revision without its queue operation or changed live plan', async (t) => {
  const { h, plans, plan } = await setup(t);
  const before = await plans.readLocalPlan(h.user, plan.id);
  const count = (await h.db.getFirstAsync('SELECT COUNT(*) count FROM local_plan_revisions')).count;
  h.failNextSql(/INSERT INTO sync_queue/);
  await assert.rejects(
    plans.updateLocalPlan(h.user, plan.id, (draft) => {
      draft.name = 'Rollback';
    }),
    /Injected SQLite/,
  );
  assert.equal((await plans.readLocalPlan(h.user, plan.id)).name, before.name);
  assert.equal(
    (await h.db.getFirstAsync('SELECT COUNT(*) count FROM local_plan_revisions')).count,
    count,
  );
});
test('local immutable revision snapshot cannot be overwritten', async (t) => {
  const { h } = await setup(t);
  await assert.rejects(h.db.runAsync("UPDATE local_plan_revisions SET snapshot='{}'"), /immutable/);
});

test('legacy unsent snapshot is reconstructed BEFORE the newer plan, without deleting either history', async (t) => {
  const { h, plans, plan } = await setup(t);
  const session = await begin(h, plan);
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.exercises[0].sets[0].repetitions = 12;
  });
  await h.db.runAsync('UPDATE sessions SET source_plan_revision_id=NULL WHERE id=?', session.id);
  await h.reopen();
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.pending, false);
  assert.equal(stored.planSnapshot.exercises[0].sets[0].repetitions, 8);
  assert.equal(h.remotePlans.get(plan.id).exercises[0].sets[0].repetitions, 12);
  assert.ok(
    (
      await h.db.getFirstAsync(
        "SELECT COUNT(*) count FROM sync_queue WHERE entity_id=? AND status='superseded'",
        plan.id,
      )
    ).count > 0,
  );
});
test('legacy original not present in published history remains pending with an explicit error, never relabeled as the latest plan', async (t) => {
  const { h, plans, plan } = await setup(t);
  const session = await begin(h, plan);
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.exercises[0].sets[0].repetitions = 12;
  });
  await plans.syncPlans(h.user);
  await h.db.runAsync('UPDATE sessions SET source_plan_revision_id=NULL WHERE id=?', session.id);
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.planVersion, 0);
  assert.equal(stored.pending, true);
  assert.ok(stored.dependencyError);
  assert.equal(stored.planSnapshot.exercises[0].sets[0].repetitions, 8);
});
test('plan list snapshot cannot overwrite a save made after the list request started', async (t) => {
  const { h, plans, plan } = await setup(t);
  await plans.syncPlans(h.user);
  const original = h.api.listPlansRequest;
  const gate = deferred(),
    entered = deferred();
  h.api.listPlansRequest = async () => {
    const old = await original();
    entered.resolve();
    await gate.promise;
    return old;
  };
  const running = plans.syncPlans(h.user);
  await entered.promise;
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.name = 'Newer than list';
  });
  gate.resolve();
  await running;
  const local = await plans.readLocalPlan(h.user, plan.id);
  assert.equal(local.name, 'Newer than list');
  assert.equal(local.pending, true);
});

test('plan conflict cannot discard the unpublished revision used by T; keep_local preserves A then publishes later B', async (t) => {
  const { h, plans, plan } = await setup(t);
  const session = await begin(h, plan);
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.name = 'B later';
    draft.exercises[0].sets[0].repetitions = 12;
  });
  const now = new Date().toISOString();
  h.remotePlans.set(plan.id, {
    ...h.plan,
    id: plan.id,
    name: 'Other device',
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const conflict = await plans.syncPlans(h.user);
  assert.ok(conflict.conflicts > 0);
  let calls = 0;
  h.api.resolvePlanConflictRequest = async (_id, choice, payload) => {
    calls++;
    const q = await h.db.getFirstAsync('SELECT * FROM sync_queue WHERE id=?', _id);
    const source = JSON.parse(q.payload).revisionOrigin;
    const official = {
      ...payload,
      version: 2,
      duplicatedFromId: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    delete official.revisionOrigin;
    h.remotePlans.set(plan.id, official);
    const revision = { originId: source.id, version: 2, snapshot: official };
    h.planBindings.set(source.id, revision);
    return { choice, plan: official, preservedPlan: null, revision };
  };
  await assert.rejects(
    plans.resolveLocalConflict(h.user, plan.id, 'keep_server'),
    /treino dependente/,
  );
  assert.equal(calls, 0);
  await plans.resolveLocalConflict(h.user, plan.id, 'keep_local');
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.pending, false);
  assert.equal(stored.planSnapshot.exercises[0].sets[0].repetitions, 8);
  assert.equal(h.remotePlans.get(plan.id).exercises[0].sets[0].repetitions, 12);
  assert.equal(h.remotePlans.get(plan.id).name, 'B later');
});

test('a remote plan revision clears an obsolete local parent before the next edit', async (t) => {
  const { h, plans, plan } = await setup(t);
  await plans.syncPlans(h.user);
  const server = h.remotePlans.get(plan.id);
  h.remotePlans.set(plan.id, { ...server, version: server.version + 1, name: 'Remote revision' });
  await plans.syncPlans(h.user);
  const fresh = await plans.readLocalPlan(h.user, plan.id);
  assert.equal(fresh.originRevisionId, null);
  await plans.updateLocalPlan(h.user, plan.id, (draft) => {
    draft.name = 'After remote';
  });
  await plans.syncPlans(h.user);
  assert.equal(h.remotePlans.get(plan.id).name, 'After remote');
});

test('a previously published plan edited offline also binds T to the edit it used, not the old or newest revision', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const plans = h.load('plans/plan-store');
  await plans.updateLocalPlan(h.user, h.plan.id, (draft) => {
    draft.exercises[0].sets = [{ ...plans.emptyPlanSet(), repetitions: 8 }];
  });
  const session = await begin(h, { id: h.plan.id });
  await plans.updateLocalPlan(h.user, h.plan.id, (draft) => {
    draft.exercises[0].sets[0].repetitions = 12;
  });
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.pending, false);
  assert.equal(stored.planVersion, 2);
  assert.equal(stored.planSnapshot.exercises[0].sets[0].repetitions, 8);
  assert.equal(h.remotePlans.get(h.plan.id).version, 3);
});

test('a legacy plan operation without an origin is acknowledged only for its exact content and leaves no false pending flag', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const plans = h.load('plans/plan-store');
  const crypto = require('node:crypto');
  const shared = require('@meutreino/shared');
  const payload = shared.planSyncPayloadSchema.parse({ ...h.plan, name: 'Legacy pending' });
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await h.db.runAsync(
    'UPDATE plans SET payload=?,name=?,pending=1,synced=0,origin_revision_id=NULL WHERE id=?',
    JSON.stringify(payload),
    payload.name,
    h.plan.id,
  );
  await h.db.runAsync(
    "INSERT INTO sync_queue(id,entity_type,entity_id,operation,idempotency_key,payload_hash,payload,base_version,status,created_at,updated_at) VALUES(?,'workout_plan',?,'upsert',?,?,?,1,'pending',?,?)",
    id,
    h.plan.id,
    crypto.randomUUID(),
    crypto.createHash('sha256').update(shared.canonicalJsonString(payload)).digest('hex'),
    JSON.stringify(payload),
    now,
    now,
  );
  const result = await plans.syncPlans(h.user);
  assert.equal(result.synced, true);
  const stored = await plans.readLocalPlan(h.user, h.plan.id);
  assert.equal(stored.pending, false);
  assert.equal(stored.name, 'Legacy pending');
});

test('an applied ACK without an official origin binding cannot mark the plan or T synchronized', async (t) => {
  const { h, plans, plan } = await setup(t);
  const session = await begin(h, plan);
  const push = h.api.pushCatalogSync;
  h.api.pushCatalogSync = async (ops) => {
    const response = await push(ops);
    return { results: response.results.map((row) => ({ id: row.id, status: row.status })) };
  };
  await assert.rejects(plans.syncPlans(h.user), /não confirmou/);
  const local = await plans.readLocalPlan(h.user, plan.id);
  assert.equal(local.pending, true);
  assert.equal((await h.store.readLocalSession(h.user, session.id)).pending, true);
  assert.equal(
    (
      await h.db.getFirstAsync(
        "SELECT COUNT(*) count FROM sync_queue WHERE entity_id=? AND status='done'",
        plan.id,
      )
    ).count,
    0,
  );
  h.api.pushCatalogSync = push;
  await h.store.syncSessions(h.user);
  assert.equal((await h.store.readLocalSession(h.user, session.id)).pending, false);
  assert.equal(h.remotePlans.get(plan.id).version, 2);
});

test('SQLite ACK failure rolls back the binding and queue together, then retries the committed server result', async (t) => {
  const { h, plans, plan } = await setup(t);
  h.failNextSql(/UPDATE sync_queue SET status='done'/);
  await assert.rejects(plans.syncPlans(h.user), /Injected SQLite/);
  const revisions = await h.db.getAllAsync(
    'SELECT * FROM local_plan_revisions WHERE plan_id=? ORDER BY local_revision',
    plan.id,
  );
  assert.equal(revisions[0].server_version, null);
  assert.equal(revisions[0].official_snapshot, null);
  await plans.syncPlans(h.user);
  assert.equal((await plans.readLocalPlan(h.user, plan.id)).pending, false);
  assert.equal(h.remotePlans.get(plan.id).version, 2);
});

test('legacy planVersion=1 with snapshot.version=0 is repaired only against the exact official revision', async (t) => {
  const h = await harness();
  t.after(() => h.close());
  const session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  const broken = {
    ...session,
    planVersion: 1,
    planSnapshot: { ...session.planSnapshot, version: 0 },
  };
  await h.db.runAsync(
    'UPDATE sessions SET payload=? WHERE id=?',
    JSON.stringify(broken),
    session.id,
  );
  await h.store.syncSessions(h.user);
  const stored = await h.store.readLocalSession(h.user, session.id);
  assert.equal(stored.pending, false);
  assert.equal(stored.planVersion, 1);
  assert.equal(stored.planSnapshot.version, 1);
  assert.ok(
    (
      await h.db.getFirstAsync(
        "SELECT COUNT(*) count FROM sync_queue WHERE entity_id=? AND status='superseded'",
        session.id,
      )
    ).count > 0,
  );
});
