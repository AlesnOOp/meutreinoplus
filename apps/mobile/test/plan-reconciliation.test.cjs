const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const shared = require('@meutreino/shared');
const { harness, deferred } = require('./support/sqlite-harness.cjs');
async function setup(t, sessionAt) {
  const h = await harness();
  t.after(() => h.close());
  const plans = () => h.load('plans/plan-store');
  let session;
  for (let i = 0; i < 2; i++) {
    await plans().updateLocalPlan(h.user, h.plan.id, (p) => {
      p.name = i ? 'B' : 'A';
    });
    if (sessionAt === i) session = await h.store.startLocalSession(h.user, h.plan.id, null, false);
  }
  h.remotePlans.set(h.plan.id, { ...h.plan, name: 'C', version: 2 });
  await plans().syncPlans(h.user);
  const before = await h.db.getAllAsync('SELECT * FROM local_plan_revisions ORDER BY rowid');
  const receipts = new Map(),
    closed = new Set();
  let calls = 0;
  const push = h.api.pushCatalogSync;
  h.api.pushCatalogSync = async (ops) => {
    const allowed = ops.filter((op) => !closed.has(op.id));
    const result = await push(allowed);
    result.results.push(
      ...ops
        .filter((op) => closed.has(op.id))
        .map((op) => ({ id: op.id, status: 'rejected', code: 'operation_closed' })),
    );
    return result;
  };
  h.api.reconcilePlanConflictRequest = async (_id, body) => {
    calls++;
    if (receipts.has(body.id)) return structuredClone(receipts.get(body.id));
    const root = body.operations[0].payload;
    const plan = h.remotePlans.get(h.plan.id);
    let q =
      body.choice === 'keep_both'
        ? {
            ...plan,
            ...shared.planSyncPayloadSchema.parse(root),
            id: crypto.randomUUID(),
            version: 1,
          }
        : null;
    if (q) h.remotePlans.set(q.id, q);
    let derived = null;
    if (body.descendants === 'reapply') {
      const source = body.operations.find(
        (op) => op.payload.revisionOrigin.id === body.sourceOriginId,
      );
      const target = q ?? plan;
      const originId = crypto.randomUUID();
      const payload = shared.planSyncMutationSchema.parse({
        ...source.payload,
        id: target.id,
        revisionOrigin: { id: originId, parentId: null },
      });
      const operation = {
        id: crypto.randomUUID(),
        entityType: 'workout_plan',
        entityId: target.id,
        operation: 'upsert',
        idempotencyKey: `derived:${body.id}`,
        payloadHash: crypto
          .createHash('sha256')
          .update(shared.canonicalJsonString(payload))
          .digest('hex'),
        baseVersion: target.version,
        createdAt: new Date().toISOString(),
        payload,
      };
      const snapshot = {
        ...target,
        ...shared.planSyncPayloadSchema.parse(payload),
        version: target.version + 1,
      };
      const revision = { originId, version: snapshot.version, snapshot };
      h.remotePlans.set(target.id, snapshot);
      h.planBindings.set(originId, revision);
      derived = { sourceOriginId: body.sourceOriginId, operation, revision };
      if (q) q = snapshot;
    }
    for (const op of body.operations) closed.add(op.id);
    const result = {
      id: body.id,
      choice: body.choice,
      plan: h.remotePlans.get(h.plan.id),
      preservedPlan: q,
      derived,
      closed: body.operations.map((op) => ({
        id: op.id,
        status: 'closed',
        originId: op.payload.revisionOrigin.id,
      })),
    };
    receipts.set(body.id, structuredClone(result));
    return structuredClone(result);
  };
  return { h, plans, before, receipts, session, calls: () => calls };
}
async function state(h) {
  return {
    revisions: await h.db.getAllAsync('SELECT * FROM local_plan_revisions ORDER BY rowid'),
    queue: await h.db.getAllAsync('SELECT * FROM sync_queue ORDER BY rowid'),
    plans: await h.db.getAllAsync('SELECT * FROM plans ORDER BY rowid'),
    sessions: await h.db.getAllAsync('SELECT * FROM sessions ORDER BY rowid'),
    decisions: await h.db.getAllAsync('SELECT * FROM local_plan_reconciliations ORDER BY rowid'),
    derivations: await h.db.getAllAsync('SELECT * FROM local_plan_derivations ORDER BY rowid'),
  };
}
for (const choice of ['keep_server', 'keep_both'])
  for (const mode of ['archive', 'reapply']) {
    test(`${choice}/${mode}: immutable A/B, one durable decision, E provenance, no active orphan and subsequent edit`, async (t) => {
      const s = await setup(t);
      const initial = await state(s.h);
      await s
        .plans()
        .reconcileLocalPlanConflict(
          s.h.user,
          s.h.plan.id,
          choice,
          mode,
          mode === 'reapply' ? s.before[1].id : null,
        );
      const after = await state(s.h);
      assert.deepEqual(after.revisions.slice(0, 2), s.before);
      assert.equal(after.decisions.length, 1);
      assert.ok(after.decisions[0].result);
      assert.equal(
        after.queue.filter((q) => ['pending', 'error', 'in_flight'].includes(q.status)).length,
        0,
      );
      for (const old of initial.queue) {
        const op = after.queue.find((q) => q.id === old.id);
        assert.equal(op.payload, old.payload);
        assert.equal(op.idempotency_key, old.idempotency_key);
        assert.equal(op.payload_hash, old.payload_hash);
        assert.equal(op.base_version, old.base_version);
      }
      assert.equal(after.plans.length, choice === 'keep_both' ? 2 : 1);
      assert.ok(after.plans.every((p) => p.conflict_operation_id === null && p.pending === 0));
      assert.equal(after.sessions.length, 0);
      const result = JSON.parse(after.decisions[0].result);
      assert.equal(result.plan.name, choice === 'keep_server' && mode === 'reapply' ? 'B' : 'C');
      assert.equal(after.derivations.length, mode === 'reapply' ? 1 : 0);
      if (mode === 'reapply') {
        assert.equal(after.derivations[0].source_origin_id, s.before[1].id);
        assert.equal(after.revisions[2].parent_id, null);
        assert.ok(after.revisions[2].server_version);
      }
      await assert.rejects(
        s.h.db.runAsync("UPDATE local_plan_revisions SET snapshot='{}'"),
        /immutable/,
      );
      await assert.rejects(
        s.h.db.runAsync("UPDATE local_plan_reconciliations SET request='{}'"),
        /immutable/,
      );
      const target = result.preservedPlan?.id ?? s.h.plan.id;
      await s.plans().updateLocalPlan(s.h.user, target, (p) => {
        p.name = 'After resolution';
      });
      assert.equal((await s.plans().syncPlans(s.h.user)).synced, true);
      assert.equal(s.h.remotePlans.get(target).name, 'After resolution');
    });
  }
for (const sessionAt of [0, 1])
  test(`unpublished dependent session ${sessionAt} keeps Recovery 04.1 block and all state`, async (t) => {
    const s = await setup(t, sessionAt);
    const before = await state(s.h);
    for (const choice of ['keep_server', 'keep_both'])
      for (const mode of ['archive', 'reapply']) {
        await assert.rejects(
          s
            .plans()
            .reconcileLocalPlanConflict(
              s.h.user,
              s.h.plan.id,
              choice,
              mode,
              mode === 'reapply' ? s.before[1].id : null,
            ),
          /treino dependente/,
        );
        assert.deepEqual(await state(s.h), before);
      }
    assert.equal(s.calls(), 0);
  });
for (const failure of ['before', 'after', 'local'])
  test(`decision failure ${failure} commit, restart and retry returns one Q/E`, async (t) => {
    const s = await setup(t);
    const send = s.h.api.reconcilePlanConflictRequest;
    let first = true;
    const requests = [];
    s.h.api.reconcilePlanConflictRequest = async (...args) => {
      requests.push(JSON.stringify(args));
      if (first && failure === 'before') {
        first = false;
        throw new Error('before commit');
      }
      const result = await send(...args);
      if (first && failure === 'after') {
        first = false;
        throw new Error('lost ACK');
      }
      return result;
    };
    if (failure === 'local') s.h.failNextSql(/UPDATE local_plan_reconciliations SET result/);
    await assert.rejects(
      s
        .plans()
        .reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_both', 'reapply', s.before[1].id),
    );
    const uncertain = await state(s.h);
    assert.equal(uncertain.decisions.length, 1);
    assert.equal(uncertain.decisions[0].result, null);
    assert.deepEqual(uncertain.revisions, s.before);
    await assert.rejects(
      s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
        p.name = 'Unsafe';
      }),
      /reconciliação aguarda confirmação/,
    );
    await s.h.reopen();
    await s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive');
    const after = await state(s.h);
    assert.equal(requests[0], requests[1]);
    assert.equal(s.receipts.size, 1);
    assert.equal(after.plans.length, 2);
    assert.equal(after.derivations.length, 1);
    assert.equal(after.revisions.length, 3);
  });
test('concurrent local decisions share one immutable intent; edits/session starts are fenced during HTTP', async (t) => {
  const s = await setup(t);
  const send = s.h.api.reconcilePlanConflictRequest;
  const entered = deferred(),
    gate = deferred();
  s.h.api.reconcilePlanConflictRequest = async (...args) => {
    entered.resolve();
    await gate.promise;
    return send(...args);
  };
  const pending = s
    .plans()
    .reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive');
  await entered.promise;
  const before = await state(s.h);
  await assert.rejects(
    s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
      p.name = 'Race';
    }),
    /reconciliação aguarda confirmação/,
  );
  await assert.rejects(
    s.h.store.startLocalSession(s.h.user, s.h.plan.id, null, false),
    /reconciliação aguarda confirmação/,
  );
  assert.deepEqual(await state(s.h), before);
  gate.resolve();
  await pending;
  assert.equal((await state(s.h)).decisions.length, 1);
});
test('stale preview has a durable rejected decision and can be explicitly retried with fresh C', async (t) => {
  const s = await setup(t);
  const send = s.h.api.reconcilePlanConflictRequest;
  let stale = true;
  s.h.api.reconcilePlanConflictRequest = async (...args) => {
    if (stale) {
      stale = false;
      throw new s.h.errors.ApiClientError('stale', 409, 'reconciliation_stale');
    }
    return send(...args);
  };
  await assert.rejects(
    s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive'),
    /nada foi reconciliado/,
  );
  const rejected = await state(s.h);
  assert.equal(JSON.parse(rejected.decisions[0].result).outcome, 'rejected');
  assert.ok(rejected.plans[0].conflict_operation_id);
  await s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive');
  assert.equal((await state(s.h)).decisions.length, 2);
  assert.equal(s.receipts.size, 1);
});

test('an edit after preview requires fresh consent; resume cannot silently create another decision', async (t) => {
  const s = await setup(t);
  await s.plans().updateLocalPlan(s.h.user, s.h.plan.id, (p) => {
    p.name = 'D after preview';
  });
  const before = await state(s.h);
  await assert.rejects(
    s
      .plans()
      .reconcileLocalPlanConflict(
        s.h.user,
        s.h.plan.id,
        'keep_server',
        'archive',
        null,
        2,
        false,
        s.before[1].id,
      ),
    /mudou durante a prévia/,
  );
  assert.deepEqual(await state(s.h), before);
  assert.equal(s.calls(), 0);
  await assert.rejects(
    s
      .plans()
      .reconcileLocalPlanConflict(
        s.h.user,
        s.h.plan.id,
        'keep_server',
        'archive',
        null,
        undefined,
        true,
      ),
    /Não existe decisão pendente/,
  );
  assert.deepEqual(await state(s.h), before);
  assert.equal(s.calls(), 0);
});

test('late sync conflict ACK cannot resurrect a reconciled queue or overwrite the displayed plan', async (t) => {
  const s = await setup(t);
  const entered = deferred(),
    release = deferred();
  const root = await s.h.db.getFirstAsync(
    "SELECT * FROM sync_queue WHERE entity_type='workout_plan' ORDER BY rowid LIMIT 1",
  );
  await s.h.db.runAsync("UPDATE sync_queue SET status='pending' WHERE id=?", root.id);
  const send = s.h.api.pushCatalogSync;
  s.h.api.pushCatalogSync = async (ops) => {
    if (ops.some((op) => op.id === root.id)) {
      entered.resolve();
      await release.promise;
      return {
        results: ops.map((op) => ({ id: op.id, status: 'conflict', code: 'version_mismatch' })),
      };
    }
    return send(ops);
  };
  const syncing = s.plans().syncPlans(s.h.user);
  await entered.promise;
  await s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive');
  release.resolve();
  const report = await syncing;
  const after = await state(s.h);
  assert.equal(after.plans[0].conflict_operation_id, null);
  assert.equal(JSON.parse(after.plans[0].payload).name, 'C');
  assert.ok(after.queue.every((q) => q.status === 'superseded'));
  assert.equal(report.conflicts, 0);
  assert.equal(report.synced, true);
});

async function loseDecisionAck(s, mode) {
  const send = s.h.api.reconcilePlanConflictRequest;
  let lose = true;
  s.h.api.reconcilePlanConflictRequest = async (...args) => {
    const result = await send(...args);
    if (lose) {
      lose = false;
      throw new s.h.errors.ApiClientError('lost committed decision ACK', 0, 'network_error');
    }
    return result;
  };
  await assert.rejects(
    s
      .plans()
      .reconcileLocalPlanConflict(
        s.h.user,
        s.h.plan.id,
        'keep_both',
        mode,
        mode === 'reapply' ? s.before[1].id : null,
      ),
    /Retomar/,
  );
  assert.equal(s.receipts.size, 1);
  const receipt = [...s.receipts.values()][0];
  await s.plans().syncPlans(s.h.user); // Q is visible in normal list before the ACK is recovered.
  assert.ok(await s.plans().readLocalPlan(s.h.user, receipt.preservedPlan.id));
  return receipt;
}
function liveFields(row) {
  const { stale_remote_version, ...live } = row;
  return live;
}
for (const mode of ['archive', 'reapply']) {
  for (const successor of ['pending', 'published', 'conflict']) {
    test(`lost ${mode} ACK preserves ${successor} F discovered on Q, including counters and next edit`, async (t) => {
      const s = await setup(t);
      const receipt = await loseDecisionAck(s, mode);
      const qid = receipt.preservedPlan.id;
      await s.plans().updateLocalPlan(s.h.user, qid, (p) => {
        p.name = 'F - newer edit';
      });
      if (successor === 'published') await s.plans().syncPlans(s.h.user);
      if (successor === 'conflict') {
        const q = s.h.remotePlans.get(qid);
        s.h.remotePlans.set(qid, { ...q, version: q.version + 1, name: 'Concurrent remote Q' });
        await s.plans().syncPlans(s.h.user);
      }
      const liveBefore = await s.h.db.getFirstAsync('SELECT * FROM plans WHERE id=?', qid);
      const queueBefore = await s.h.db.getAllAsync(
        'SELECT * FROM sync_queue WHERE entity_id=? ORDER BY rowid',
        qid,
      );
      const ledgerBefore = await s.h.db.getAllAsync(
        'SELECT * FROM local_plan_revisions WHERE plan_id=? ORDER BY local_revision',
        qid,
      );
      await s.h.reopen();
      await s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_server', 'archive');
      const liveAfter = await s.h.db.getFirstAsync('SELECT * FROM plans WHERE id=?', qid);
      assert.deepEqual(liveFields(liveAfter), liveFields(liveBefore));
      for (const op of queueBefore) {
        assert.deepEqual(
          await s.h.db.getFirstAsync('SELECT * FROM sync_queue WHERE id=?', op.id),
          op,
        );
      }
      for (const rev of ledgerBefore) {
        assert.deepEqual(
          await s.h.db.getFirstAsync('SELECT * FROM local_plan_revisions WHERE id=?', rev.id),
          rev,
        );
      }
      const decisions = await s.h.db.getAllAsync('SELECT * FROM local_plan_reconciliations');
      assert.equal(decisions.length, 1);
      assert.deepEqual(JSON.parse(decisions[0].result), receipt);
      assert.equal((await s.h.db.getFirstAsync('SELECT COUNT(*) n FROM plans')).n, 2);
      if (mode === 'reapply') {
        const e = await s.h.db.getFirstAsync(
          'SELECT * FROM local_plan_revisions WHERE id=?',
          receipt.derived.revision.originId,
        );
        assert.equal(e.server_version, receipt.derived.revision.version);
        assert.deepEqual(JSON.parse(e.official_snapshot), receipt.derived.revision.snapshot);
        assert.equal(e.parent_id, null);
        assert.notEqual(liveAfter.origin_revision_id, e.id);
        assert.equal(
          (await s.h.db.getFirstAsync('SELECT COUNT(*) n FROM local_plan_derivations')).n,
          1,
        );
      }
      // The historical append must not steal the next live revision number or parent.
      await s.plans().updateLocalPlan(s.h.user, qid, (p) => {
        p.name = 'G after historical ACK';
      });
      const g = await s.h.db.getFirstAsync(
        'SELECT * FROM local_plan_revisions WHERE plan_id=? ORDER BY local_revision DESC LIMIT 1',
        qid,
      );
      assert.equal(g.parent_id, liveBefore.origin_revision_id);
      assert.ok(g.local_revision > liveBefore.local_revision);
      if (successor !== 'conflict') {
        assert.equal((await s.plans().syncPlans(s.h.user)).synced, true);
        assert.equal(s.h.remotePlans.get(qid).name, 'G after historical ACK');
      } else {
        assert.equal(
          (await s.plans().readLocalPlan(s.h.user, qid)).conflictOperationId,
          liveBefore.conflict_operation_id,
        );
      }
    });
  }
}
for (const mode of ['archive', 'reapply']) {
  test(`lost ${mode} ACK leaves a session on F attached to F and able to converge`, async (t) => {
    const s = await setup(t);
    const receipt = await loseDecisionAck(s, mode);
    const qid = receipt.preservedPlan.id;
    await s.plans().updateLocalPlan(s.h.user, qid, (p) => {
      p.name = 'F used by session';
    });
    const session = await s.h.store.startLocalSession(s.h.user, qid, null, false);
    const before = await s.h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
    await s.h.reopen();
    await s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_both', mode);
    assert.deepEqual(
      await s.h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id),
      before,
    );
    assert.equal((await s.plans().readLocalPlan(s.h.user, qid)).name, 'F used by session');
    assert.equal((await s.h.store.syncSessions(s.h.user)).synced, true);
    const synced = await s.h.store.readLocalSession(s.h.user, session.id);
    assert.equal(synced.planSnapshot.name, 'F used by session');
    assert.equal(synced.pending, false);
    assert.equal(synced.planVersion, synced.planSnapshot.version);
    const row = await s.h.db.getFirstAsync('SELECT * FROM sessions WHERE id=?', session.id);
    assert.equal(row.source_plan_revision_id, before.source_plan_revision_id);
    assert.notEqual(row.source_plan_revision_id, receipt.derived?.revision.originId);
  });
}
test('historical ACK rollback preserves F and intent, retries once, and serializes concurrent Q edit', async (t) => {
  const s = await setup(t);
  const receipt = await loseDecisionAck(s, 'reapply');
  const qid = receipt.preservedPlan.id;
  await s.plans().updateLocalPlan(s.h.user, qid, (p) => {
    p.name = 'F before rollback';
  });
  const before = await state(s.h);
  s.h.failNextSql(/UPDATE local_plan_reconciliations SET result/);
  await assert.rejects(
    s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_both', 'reapply'),
    /Injected SQLite/,
  );
  assert.deepEqual(await state(s.h), before);
  const send = s.h.api.reconcilePlanConflictRequest;
  const entered = deferred(),
    release = deferred();
  s.h.api.reconcilePlanConflictRequest = async (...args) => {
    const result = await send(...args);
    entered.resolve();
    await release.promise;
    return result;
  };
  const ack = s.plans().reconcileLocalPlanConflict(s.h.user, s.h.plan.id, 'keep_both', 'reapply');
  await entered.promise;
  await s.plans().updateLocalPlan(s.h.user, qid, (p) => {
    p.name = 'G while ACK in flight';
  });
  release.resolve();
  await ack;
  assert.equal((await s.plans().readLocalPlan(s.h.user, qid)).name, 'G while ACK in flight');
  assert.equal((await s.plans().readLocalPlan(s.h.user, qid)).pending, true);
  assert.equal((await s.h.db.getFirstAsync('SELECT COUNT(*) n FROM local_plan_derivations')).n, 1);
  assert.equal(
    (
      await s.h.db.getFirstAsync(
        'SELECT COUNT(*) n FROM local_plan_reconciliations WHERE result IS NOT NULL',
      )
    ).n,
    1,
  );
  assert.equal((await s.plans().syncPlans(s.h.user)).synced, true);
});
