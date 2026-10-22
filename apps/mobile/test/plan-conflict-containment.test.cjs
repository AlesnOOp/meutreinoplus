const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { harness, deferred } = require('./support/sqlite-harness.cjs');

async function setup(t, { sessionAt, depth = 2 } = {}) {
  const h = await harness();
  t.after(() => h.close());
  const plans = () => h.load('plans/plan-store');
  let session;
  for (let i = 0; i < depth; i++) {
    await plans().updateLocalPlan(h.user, h.plan.id, (p) => {
      p.name = ['A', 'B', 'D'][i];
    });
    if (sessionAt === i) session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  }
  h.remotePlans.set(h.plan.id, { ...h.plan, name: 'C', version: 2 });
  await plans().syncPlans(h.user);
  const ops = await h.db.getAllAsync(
    "SELECT * FROM sync_queue WHERE entity_type='workout_plan' ORDER BY rowid",
  );
  const source = JSON.parse(ops[0].payload).revisionOrigin;
  let calls = 0,
    committed = null;
  h.api.resolvePlanConflictRequest = async (_id, choice, payload) => {
    calls++;
    if (committed) return structuredClone(committed);
    const remote = h.remotePlans.get(h.plan.id);
    const local = { ...remote, ...payload, version: remote.version + 1 };
    delete local.revisionOrigin;
    const revision = { originId: source.id, version: local.version, snapshot: local };
    if (choice === 'keep_local') {
      h.remotePlans.set(h.plan.id, local);
      h.planBindings.set(source.id, revision);
    }
    committed = {
      choice,
      plan: choice === 'keep_local' ? local : remote,
      preservedPlan: choice === 'keep_both' ? { ...local, id: crypto.randomUUID() } : null,
      ...(choice === 'keep_local' ? { revision } : {}),
    };
    return structuredClone(committed);
  };
  return { h, plans, ops, source, session, calls: () => calls };
}
async function state(h) {
  return {
    revisions: await h.db.getAllAsync('SELECT * FROM local_plan_revisions ORDER BY rowid'),
    queue: await h.db.getAllAsync('SELECT * FROM sync_queue ORDER BY rowid'),
    plans: await h.db.getAllAsync('SELECT * FROM plans ORDER BY rowid'),
    sessions: await h.db.getAllAsync('SELECT * FROM sessions ORDER BY rowid'),
    intents: await h.db.getAllAsync('SELECT * FROM plan_conflict_intents'),
  };
}
function frozen(rows) {
  return rows.map(({ server_version, official_snapshot, ...immutable }) => immutable);
}
for (const choice of ['keep_server', 'keep_both']) {
  for (const sessionAt of [undefined, 0, 1]) {
    test(`${choice}: A→B, session=${sessionAt ?? 'none'}, blocked atomically with actionable keep_local path`, async (t) => {
      const s = await setup(t, { sessionAt });
      const before = await state(s.h);
      for (let retry = 0; retry < 2; retry++) {
        await assert.rejects(
          s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, choice),
          /Manter a versão deste aparelho/,
        );
        assert.deepEqual(await state(s.h), before);
      }
      assert.equal(s.calls(), 0);
      await s.h.reopen();
      assert.deepEqual(await state(s.h), before);
      await s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_local');
      await s.plans().syncPlans(s.h.user);
      if (s.session) await s.h.store.syncSessions(s.h.user);
      const after = await state(s.h);
      assert.deepEqual(frozen(after.revisions), frozen(before.revisions));
      assert.ok(after.revisions.every((r) => r.server_version > 0));
      assert.ok(
        after.queue
          .filter((q) => q.entity_type === 'workout_plan')
          .every((q) => q.status === 'done'),
      );
      assert.equal(after.plans[0].conflict_operation_id, null);
      assert.equal(JSON.parse(after.plans[0].payload).name, 'B');
      if (s.session) {
        const local = await s.h.store.readLocalSession(s.h.user, s.session.id);
        assert.equal(local.planSnapshot.name, sessionAt === 0 ? 'A' : 'B');
        assert.equal(local.pending, false);
        assert.equal(local.planVersion, local.planSnapshot.version);
      }
      await s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
        p.name = 'After decision';
      });
      assert.equal((await s.plans().syncPlans(s.h.user)).synced, true);
    });
  }
}
for (const status of ['pending', 'in_flight', 'done', 'superseded']) {
  test(`A→B→D inspects indirect revision and ${status} attempted/confirmed/substituted operations`, async (t) => {
    const s = await setup(t, { depth: 3, sessionAt: 2 });
    await s.h.db.runAsync(
      'UPDATE sync_queue SET status=?,attempt_count=2 WHERE id=?',
      status,
      s.ops[2].id,
    );
    // Detect indirect D even when intermediate B has no active queue row.
    await s.h.db.runAsync("UPDATE sync_queue SET status='superseded' WHERE id=?", s.ops[1].id);
    const graph = await s.h
      .load('plans/conflict-containment')
      .inspectPlanConflictDependencies(s.h.db, s.h.plan.id, s.ops[0].id, s.source.id);
    assert.equal(graph.descendants.length, 2);
    assert.equal(graph.sessions.length, 1);
    assert.ok(
      graph.operations.some(
        (op) => op.id === s.ops[2].id && op.status === status && op.attempt_count === 2,
      ),
    );
    const before = await state(s.h);
    for (const choice of ['keep_server', 'keep_both']) {
      await assert.rejects(
        s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, choice),
        /2 revisões, 1 treinos/,
      );
      assert.deepEqual(await state(s.h), before);
    }
    assert.equal(s.calls(), 0);
  });
}
for (const choice of ['keep_server', 'keep_both']) {
  test(`${choice}: leaf intent survives lost ACK, runtime restart and retry; edits cannot race confirmation`, async (t) => {
    const s = await setup(t, { depth: 1 });
    const immutable = await state(s.h);
    const real = s.h.api.resolvePlanConflictRequest;
    let lose = true;
    s.h.api.resolvePlanConflictRequest = async (...args) => {
      const result = await real(...args);
      if (lose) {
        lose = false;
        throw new s.h.errors.ApiClientError('lost ACK', 0, 'network_error');
      }
      return result;
    };
    await assert.rejects(s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, choice), /Repita/);
    const uncertain = await state(s.h);
    assert.deepEqual(uncertain.revisions, immutable.revisions);
    assert.deepEqual(uncertain.queue, immutable.queue);
    assert.equal(uncertain.intents.length, 1);
    await s.h.reopen();
    assert.equal(
      (await s.plans().readLocalPlan(s.h.user, s.h.plan.id)).resolutionPendingChoice,
      choice,
    );
    const beforeRetry = await state(s.h);
    await assert.rejects(
      s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
        p.name = 'Unsafe';
      }),
      /aguarda confirmação/,
    );
    await assert.rejects(
      s.h.store.startLocalSession(s.h.user, s.h.plan.id, null, false),
      /aguarda confirmação/,
    );
    await assert.rejects(
      s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_local'),
      /Repita/,
    );
    assert.deepEqual(await state(s.h), beforeRetry);
    await s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, choice);
    const after = await state(s.h);
    assert.deepEqual(after.revisions, immutable.revisions);
    assert.equal(after.intents.length, 0);
    assert.equal(after.plans.find((p) => p.id === s.h.plan.id).conflict_operation_id, null);
    assert.equal(after.queue.find((q) => q.id === s.ops[0].id).status, 'done');
    assert.equal(after.plans.length, choice === 'keep_both' ? 2 : 1);
    assert.equal(JSON.parse(after.plans.find((p) => p.id === s.h.plan.id).payload).name, 'C');
    if (choice === 'keep_both')
      assert.equal(JSON.parse(after.plans.find((p) => p.id !== s.h.plan.id).payload).name, 'A');
    assert.equal(after.sessions.length, 0);
    assert.equal(s.calls(), 2);
    await s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
      p.name = 'Safe after decision';
    });
    const added = (await state(s.h)).revisions.at(-1);
    assert.equal(added.parent_id, null);
    assert.equal(added.base_version, 2);
    assert.equal((await s.plans().syncPlans(s.h.user)).synced, true);
  });
}
test('edit winning before the preflight blocks discard; edit after durable preflight is refused until ACK', async (t) => {
  const s = await setup(t, { depth: 1 });
  const entered = deferred(),
    release = deferred();
  const real = s.h.api.resolvePlanConflictRequest;
  s.h.api.resolvePlanConflictRequest = async (...args) => {
    entered.resolve();
    await release.promise;
    return real(...args);
  };
  const resolving = s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_server');
  await entered.promise;
  const before = await state(s.h);
  await assert.rejects(
    s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
      p.name = 'Race';
    }),
    /aguarda confirmação/,
  );
  await assert.rejects(
    s.h.store.startLocalSession(s.h.user, s.h.plan.id, null, false),
    /aguarda confirmação/,
  );
  assert.deepEqual(await state(s.h), before);
  release.resolve();
  await resolving;
  assert.equal((await state(s.h)).intents.length, 0);
});
test('local ACK transaction failure retains intent and conflict for same-decision recovery', async (t) => {
  const s = await setup(t, { depth: 1 });
  const before = await state(s.h);
  s.h.failNextSql(/DELETE FROM plan_conflict_intents/);
  await assert.rejects(
    s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_server'),
    /Injected SQLite/,
  );
  const failed = await state(s.h);
  assert.deepEqual(failed.revisions, before.revisions);
  assert.deepEqual(failed.queue, before.queue);
  assert.deepEqual(failed.plans, before.plans);
  assert.equal(failed.intents.length, 1);
  await s.h.reopen();
  await s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_server');
  assert.equal((await state(s.h)).intents.length, 0);
});
test('a session that read A before discard is refused atomically after confirmation', async (t) => {
  const s = await setup(t, { depth: 1 });
  const entered = deferred(),
    release = deferred();
  const original = s.h.db.getFirstAsync.bind(s.h.db);
  let intercept = true;
  s.h.db.getFirstAsync = async (sql, ...args) => {
    const result = await original(sql, ...args);
    if (intercept && sql.includes('SELECT * FROM plans WHERE id = ?')) {
      intercept = false;
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  const starting = s.h.store.startLocalSession(s.h.user, s.h.plan.id, null, false);
  const outcome = assert.rejects(starting, /Reabra a ficha/);
  await entered.promise;
  await s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_server');
  release.resolve();
  await outcome;
  assert.equal((await state(s.h)).sessions.length, 0);
});

test('keep_local A→B survives lost ACK, another edit D, restart and retry without changing attempted payloads', async (t) => {
  const s = await setup(t, { sessionAt: 1 });
  const original = await state(s.h);
  const real = s.h.api.resolvePlanConflictRequest;
  let lost = true;
  s.h.api.resolvePlanConflictRequest = async (...args) => {
    const result = await real(...args);
    if (lost) {
      lost = false;
      throw new s.h.errors.ApiClientError('lost', 0, 'network_error');
    }
    return result;
  };
  await assert.rejects(
    s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_local'),
    /Repita/,
  );
  await s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
    p.name = 'D';
  });
  await s.h.reopen();
  await s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_local');
  assert.equal((await s.h.store.syncSessions(s.h.user)).synced, true);
  const after = await state(s.h);
  assert.deepEqual(frozen(after.revisions.slice(0, 2)), frozen(original.revisions));
  for (const old of original.queue) {
    const current = after.queue.find((q) => q.id === old.id);
    assert.equal(current.payload, old.payload);
    assert.equal(current.payload_hash, old.payload_hash);
    assert.equal(current.idempotency_key, old.idempotency_key);
    assert.equal(current.base_version, old.base_version);
  }
  assert.equal(after.intents.length, 0);
  assert.ok(after.revisions.every((r) => r.server_version > 0));
  assert.equal(JSON.parse(after.plans[0].payload).name, 'D');
  const session = await s.h.store.readLocalSession(s.h.user, s.session.id);
  assert.equal(session.planSnapshot.name, 'B');
  assert.equal(session.pending, false);
});
test('sessions attached to descendants are detected even if marked synchronized locally', async (t) => {
  const s = await setup(t, { sessionAt: 1 });
  await s.h.db.runAsync('UPDATE sessions SET pending=0,synced=1 WHERE id=?', s.session.id);
  const graph = await s.h
    .load('plans/conflict-containment')
    .inspectPlanConflictDependencies(s.h.db, s.h.plan.id, s.ops[0].id, s.source.id);
  assert.equal(graph.sessions.length, 1);
  assert.equal(graph.sessions[0].pending, 0);
  const before = await state(s.h);
  await assert.rejects(
    s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_both'),
    /Manter a versão deste aparelho/,
  );
  assert.deepEqual(await state(s.h), before);
});
test('atomic preflight rollback creates no intent and makes no remote decision', async (t) => {
  const s = await setup(t, { depth: 1 });
  const before = await state(s.h);
  s.h.failNextSql(/INSERT INTO plan_conflict_intents/);
  await assert.rejects(
    s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, 'keep_server'),
    /Injected SQLite/,
  );
  assert.deepEqual(await state(s.h), before);
  assert.equal(s.calls(), 0);
});

test('missing immutable origin fails closed for every choice and asks for assisted recovery', async (t) => {
  const s = await setup(t);
  // Simulate pre-existing corruption only in the disposable SQLite fixture.
  await s.h.db.execAsync('DROP TRIGGER local_plan_revision_no_delete');
  await s.h.db.runAsync('DELETE FROM local_plan_revisions WHERE id=?', s.source.id);
  const before = await state(s.h);
  for (const choice of ['keep_server', 'keep_both', 'keep_local']) {
    await assert.rejects(
      s.plans().resolveLocalConflict(s.h.user, s.h.plan.id, choice),
      /recuperação assistida/,
    );
    assert.deepEqual(await state(s.h), before);
  }
  assert.equal(s.calls(), 0);
});
