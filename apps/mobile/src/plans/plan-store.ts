import {
  canonicalJsonString,
  canonicalPlanContent,
  planSchema,
  planSyncMutationSchema,
  planSyncPayloadSchema,
  type PlanExerciseInput,
  type PlanSyncPayload,
  type PlanView,
} from '@meutreino/shared';
import * as Crypto from 'expo-crypto';
import { pushCatalogSync } from '@/api/catalog';
import { isNetworkError } from '@/api/errors';
import { listPlansRequest, resolvePlanConflictRequest } from '@/api/plans';
import { syncCatalog } from '@/catalog/catalog-store';
import {
  captureRevisions,
  claimOperations,
  localTransaction,
  releaseOperations,
  singleSync,
  canApplyRemote,
  hasPending,
} from '@/db/sync-state';
import { openLocalDatabase } from '@/db/local-database';

import {
  assertPlanCanGainDependencies,
  inspectPlanConflictDependencies,
  readPlanConflictIntent,
  resolutionLabel,
  type PlanChoice,
} from './conflict-containment';

type Database = Awaited<ReturnType<typeof openLocalDatabase>>;

type PlanRow = {
  id: string;
  local_revision: number;
  origin_revision_id: string | null;
  name: string;
  description: string | null;
  accent: string | null;
  status: 'active' | 'archived';
  version: number;
  payload: string;
  updated_at: string;
  pending: number;
  synced: number;
  conflict_operation_id: string | null;
};

export type LocalPlan = PlanSyncPayload & {
  originRevisionId?: string | null;
  officialSnapshot?: PlanView;
  resolutionPendingChoice?: PlanChoice;
  version: number;
  pending: boolean;
  synced: boolean;
  conflictOperationId: string | null;
  updatedAt: string;
};

export async function listLocalPlans(
  userId: string,
  status: 'active' | 'archived',
): Promise<LocalPlan[]> {
  const database = await openLocalDatabase(userId);
  const rows = await database.getAllAsync<PlanRow>(
    `SELECT * FROM plans WHERE status = ? ORDER BY updated_at DESC`,
    status,
  );
  return rows.map(mapPlan);
}

export async function readLocalPlan(userId: string, planId: string): Promise<LocalPlan | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<PlanRow>(`SELECT * FROM plans WHERE id = ?`, planId);
  if (!row) return null;
  const intent = await readPlanConflictIntent(database, planId);
  return { ...mapPlan(row), resolutionPendingChoice: intent?.choice };
}

export async function createLocalPlan(
  userId: string,
  input: { name: string; description: string | null; accent: LocalPlan['accent'] },
): Promise<LocalPlan> {
  const plan = blankPlan(Crypto.randomUUID(), input);
  await commit(userId, plan, null);
  return (await readLocalPlan(userId, plan.id)) ?? plan;
}

export async function updateLocalPlan(
  userId: string,
  planId: string,
  change: (plan: LocalPlan) => void,
): Promise<LocalPlan> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    const row = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id = ?', planId);
    if (!row) throw new Error('Ficha não encontrada.');
    const current = mapPlan(row);
    change(current);
    await commitInTransaction(tx, current, row.version > 0 ? row.version : null);
  });
  return (await readLocalPlan(userId, planId))!;
}

export async function duplicateLocalPlan(userId: string, planId: string): Promise<LocalPlan> {
  const current = await readLocalPlan(userId, planId);
  if (!current) {
    throw new Error('Ficha não encontrada.');
  }
  const copy = blankPlan(Crypto.randomUUID(), {
    name: `${current.name.slice(0, 112)} (cópia)`,
    description: current.description,
    accent: current.accent,
  });
  copy.exercises = current.exercises.map((exercise) => ({
    ...exercise,
    id: Crypto.randomUUID(),
    sets: exercise.sets.map((set) => ({ ...set, id: Crypto.randomUUID() })),
  }));
  await commit(userId, copy, null);
  return (await readLocalPlan(userId, copy.id)) ?? copy;
}

export function syncPlans(userId: string): Promise<{ synced: boolean; conflicts: number }> {
  return singleSync(userId, 'plans', () => runPlanSync(userId));
}
async function runPlanSync(userId: string): Promise<{ synced: boolean; conflicts: number }> {
  const catalog = await syncCatalog(userId);
  const database = await openLocalDatabase(userId);
  await recoverLegacyPlanDependencies(database);
  await localTransaction(database, async (tx) => {
    const unqueued = await tx.getAllAsync<PlanRow>(
      "SELECT p.* FROM plans p WHERE p.pending=1 AND p.origin_revision_id IS NULL AND p.conflict_operation_id IS NULL AND NOT EXISTS(SELECT 1 FROM sync_queue q WHERE q.entity_type='workout_plan' AND q.entity_id=p.id AND q.status IN ('pending','in_flight','error'))",
    );
    for (const row of unqueued)
      await commitInTransaction(tx, mapPlan(row), row.version > 0 ? row.version : null);
  });
  let conflicts = catalog.conflicts;
  for (let pass = 0; pass < 20; pass++) {
    const queued = await claimOperations(database, ['workout_plan']);
    if (!queued.length) break;
    let applied = 0;
    try {
      const result = await pushCatalogSync(
        queued.map((row) => ({
          id: row.id,
          entityType: 'workout_plan',
          entityId: row.entity_id,
          operation: row.operation,
          idempotencyKey: row.idempotency_key,
          payloadHash: row.payload_hash,
          baseVersion: row.base_version,
          createdAt: row.created_at,
          payload: JSON.parse(row.payload) as unknown,
        })),
      );
      for (const item of result.results) {
        const row = queued.find((candidate) => candidate.id === item.id);
        if (!row) continue;
        if (item.status === 'applied') {
          const sent = planSyncMutationSchema.parse(JSON.parse(row.payload));
          if (
            sent.revisionOrigin &&
            (!item.revision ||
              item.revision.originId !== sent.revisionOrigin.id ||
              item.revision.version !== item.revision.snapshot.version ||
              canonicalPlanContent(sent) !== canonicalPlanContent(item.revision.snapshot))
          )
            throw new Error(
              'O servidor não confirmou a revisão original da ficha. Os dados continuam pendentes.',
            );
          await localTransaction(database, async (tx) => {
            const active = await tx.getFirstAsync<{ status: string }>(
              'SELECT status FROM sync_queue WHERE id = ?',
              row.id,
            );
            if (!active || ['done', 'superseded'].includes(active.status)) return;
            if (item.revision) {
              const previous = await tx.getFirstAsync<{
                server_version: number | null;
                official_snapshot: string | null;
              }>(
                'SELECT server_version,official_snapshot FROM local_plan_revisions WHERE id = ?',
                item.revision.originId,
              );
              if (previous?.server_version && previous.server_version !== item.revision.version)
                throw new Error('Vínculo de revisão incompatível.');
              await tx.runAsync(
                'UPDATE local_plan_revisions SET server_version = ?, official_snapshot = ? WHERE id = ?',
                item.revision.version,
                JSON.stringify(item.revision.snapshot),
                item.revision.originId,
              );
            }
            await tx.runAsync(
              "UPDATE sync_queue SET status='done',last_error=NULL,updated_at=? WHERE id=?",
              new Date().toISOString(),
              row.id,
            );
            const current = await tx.getFirstAsync<PlanRow>(
              'SELECT * FROM plans WHERE id = ?',
              row.entity_id,
            );
            const remaining = await tx.getFirstAsync(
              "SELECT id FROM sync_queue WHERE entity_type='workout_plan' AND entity_id=? AND status IN ('pending','in_flight','error')",
              row.entity_id,
            );
            const version = item.revision?.version ?? (row.base_version ?? 0) + 1;
            if (!sent.revisionOrigin && current) {
              await tx.runAsync(
                "UPDATE sync_queue SET base_version=? WHERE entity_type='workout_plan' AND entity_id=? AND status='pending' AND attempt_count=0 AND (base_version IS NULL OR base_version<?)",
                version,
                row.entity_id,
                version,
              );
              if (
                !remaining &&
                canonicalPlanContent(current.payload ? JSON.parse(current.payload) : sent) ===
                  canonicalPlanContent(sent)
              ) {
                await tx.runAsync(
                  'UPDATE plans SET version=MAX(version,?),acknowledged_revision=MAX(acknowledged_revision,?),pending=0,synced=1 WHERE id=?',
                  version,
                  current.local_revision,
                  row.entity_id,
                );
                return;
              }
              if (!remaining && !current.origin_revision_id) {
                await tx.runAsync(
                  'UPDATE plans SET version=MAX(version,?) WHERE id=?',
                  version,
                  row.entity_id,
                );
                await commitInTransaction(
                  tx,
                  mapPlan({ ...current, version: Math.max(version, current.version) }),
                  version,
                );
                return;
              }
            }

            if (
              current &&
              current.local_revision === row.local_revision &&
              !remaining &&
              item.revision
            )
              await writeServerPlan(tx, item.revision.snapshot);
            else
              await tx.runAsync(
                'UPDATE plans SET version=MAX(version,?),acknowledged_revision=MAX(acknowledged_revision,?),pending=1,synced=0 WHERE id=?',
                version,
                row.local_revision,
                row.entity_id,
              );
            await tx.runAsync(
              'UPDATE plans SET acknowledged_revision=MAX(acknowledged_revision,?) WHERE id=?',
              row.local_revision,
              row.entity_id,
            );
          });
          applied++;
        } else if (item.code !== 'plan_dependency_missing') {
          conflicts += item.status === 'conflict' ? 1 : 0;
          await localTransaction(database, async (tx) => {
            await tx.runAsync(
              "UPDATE sync_queue SET status='error',last_error=?,updated_at=? WHERE id=?",
              item.code ?? item.status,
              new Date().toISOString(),
              row.id,
            );
            if (item.status === 'conflict')
              await tx.runAsync(
                'UPDATE plans SET conflict_operation_id=?,pending=1,synced=0 WHERE id=?',
                row.id,
                row.entity_id,
              );
          });
        }
      }
    } catch (error) {
      await releaseOperations(database, queued);
      if (isNetworkError(error)) return { synced: false, conflicts };
      throw error;
    }
    await releaseOperations(database, queued);
    if (!applied) break;
  }
  try {
    await refreshPlans(database);
  } catch (error) {
    if (isNetworkError(error)) return { synced: false, conflicts };
    throw error;
  }
  return { synced: catalog.synced && !(await hasPending(database, ['workout_plan'])), conflicts };
}

export async function resolveLocalConflict(
  userId: string,
  planId: string,
  choice: 'keep_server' | 'keep_local' | 'keep_both',
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const prepared = await localTransaction(database, async (tx) => {
    const row = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id=?', planId);
    if (!row?.conflict_operation_id) return null;
    const intent = await readPlanConflictIntent(tx, planId);
    if (intent && (intent.conflict_id !== row.conflict_operation_id || intent.choice !== choice))
      throw new Error(
        `Uma decisão aguarda confirmação. Repita “${resolutionLabel(intent.choice)}” para retomá-la antes de escolher outra opção.`,
      );
    const operation = await tx.getFirstAsync<{
      id: string;
      payload: string;
      local_revision: number;
    }>('SELECT id,payload,local_revision FROM sync_queue WHERE id=?', row.conflict_operation_id);
    const sent = operation ? planSyncMutationSchema.parse(JSON.parse(operation.payload)) : null;
    if (!intent) {
      const graph = await inspectPlanConflictDependencies(
        tx,
        planId,
        row.conflict_operation_id,
        sent?.revisionOrigin?.id ?? null,
      );
      if (graph.missingOrigin && sent?.revisionOrigin)
        throw new Error(
          'A origem local desta revisão está ausente. As decisões foram bloqueadas para preservar os dados. Preserve o backup deste aparelho e solicite recuperação assistida; não apague a ficha nem reinstale o aplicativo.',
        );
      if (
        choice !== 'keep_local' &&
        (graph.missingOrigin ||
          graph.descendants.length ||
          graph.sessions.length ||
          graph.unknownOperations.length)
      )
        throw new Error(
          `Esta revisão possui alterações posteriores ou treino dependente (${graph.descendants.length} revisões, ${graph.sessions.length} treinos). Escolha “Manter a versão deste aparelho” para publicar a origem e retomar a sincronização. Depois revise as edições seguintes. Nada foi descartado.`,
        );
    }
    const requestPayload = intent
      ? intent.payload
        ? planSyncPayloadSchema.parse(JSON.parse(intent.payload))
        : undefined
      : choice === 'keep_server'
        ? undefined
        : planSyncPayloadSchema.parse(sent ?? mapPlan(row));
    if (!intent)
      await tx.runAsync(
        'INSERT INTO plan_conflict_intents(plan_id,conflict_id,choice,payload,created_at) VALUES(?,?,?,?,?)',
        planId,
        row.conflict_operation_id,
        choice,
        requestPayload ? JSON.stringify(requestPayload) : null,
        new Date().toISOString(),
      );
    return { row, operation, sent, requestPayload };
  });
  if (!prepared) return;
  const { row, operation, sent, requestPayload } = prepared;
  let result: Awaited<ReturnType<typeof resolvePlanConflictRequest>>;
  try {
    result = await resolvePlanConflictRequest(row.conflict_operation_id!, choice, requestPayload);
  } catch {
    throw new Error(
      `A confirmação da decisão não chegou. Os dados continuam preservados. Repita “${resolutionLabel(choice)}” neste conflito para retomar a mesma decisão; não escolha outra opção ainda. Se a recusa persistir, preserve este aparelho e solicite recuperação assistida.`,
    );
  }
  if (
    sent?.revisionOrigin &&
    choice === 'keep_local' &&
    (!result.revision ||
      result.revision.originId !== sent.revisionOrigin.id ||
      canonicalPlanContent(sent) !== canonicalPlanContent(result.revision.snapshot))
  )
    throw new Error('A revisão original ainda não foi confirmada.');
  await localTransaction(database, async (tx) => {
    const latest = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id=?', planId);
    if (latest?.conflict_operation_id !== row.conflict_operation_id) return;
    if (result.revision)
      await tx.runAsync(
        'UPDATE local_plan_revisions SET server_version=?,official_snapshot=? WHERE id=?',
        result.revision.version,
        JSON.stringify(result.revision.snapshot),
        result.revision.originId,
      );
    await tx.runAsync(
      "UPDATE sync_queue SET status='done',last_error=NULL,updated_at=? WHERE id=?",
      new Date().toISOString(),
      row.conflict_operation_id,
    );
    const more = await tx.getFirstAsync(
      "SELECT id FROM sync_queue WHERE entity_type='workout_plan' AND entity_id=? AND status IN ('pending','in_flight','error')",
      planId,
    );
    if (latest.local_revision === (operation?.local_revision ?? row.local_revision) && !more)
      await writeServerPlan(tx, result.plan);
    else
      await tx.runAsync(
        'UPDATE plans SET conflict_operation_id=NULL,pending=1,synced=0,version=MAX(version,?) WHERE id=?',
        result.plan.version,
        planId,
      );
    if (result.preservedPlan) await writeServerPlan(tx, result.preservedPlan);
    await tx.runAsync(
      'DELETE FROM plan_conflict_intents WHERE plan_id=? AND conflict_id=?',
      planId,
      row.conflict_operation_id,
    );
  });
}

async function commit(userId: string, plan: LocalPlan, baseVersion: number | null) {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, (tx) => commitInTransaction(tx, plan, baseVersion));
}
async function commitInTransaction(
  database: Database,
  plan: LocalPlan,
  baseVersion: number | null,
) {
  await assertPlanCanGainDependencies(database, plan.id);
  const existing = await database.getFirstAsync<PlanRow>(
    'SELECT * FROM plans WHERE id = ?',
    plan.id,
  );
  const payload = planSyncPayloadSchema.parse({
    ...plan,
    exercises: plan.exercises.map((ex, index) => ({
      ...ex,
      orderIndex: index + 1,
      sets: ex.sets.map((set, setIndex) => ({ ...set, setIndex: setIndex + 1 })),
    })),
  });
  const now = new Date().toISOString();
  const next = (existing?.local_revision ?? 0) + 1;
  const id = Crypto.randomUUID();
  const parent = existing?.origin_revision_id ?? null;
  await database.runAsync(
    'INSERT INTO local_plan_revisions(id,plan_id,local_revision,snapshot,parent_id,base_version,created_at) VALUES(?,?,?,?,?,?,?)',
    id,
    plan.id,
    next,
    JSON.stringify(payload),
    parent,
    baseVersion,
    now,
  );
  await database.runAsync(
    `INSERT INTO plans(id,name,description,accent,status,version,payload,updated_at,pending,synced,conflict_operation_id,local_revision,origin_revision_id)
    VALUES(?,?,?,?,?,?,?,?,1,0,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,accent=excluded.accent,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at,pending=1,synced=0,local_revision=excluded.local_revision,origin_revision_id=excluded.origin_revision_id`,
    payload.id,
    payload.name,
    payload.description,
    payload.accent ?? null,
    payload.status,
    existing?.version ?? 0,
    JSON.stringify(payload),
    now,
    existing?.conflict_operation_id ?? null,
    next,
    id,
  );
  const mutation = planSyncMutationSchema.parse({
    ...payload,
    revisionOrigin: { id, parentId: parent },
  });
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJsonString(mutation),
  );
  await database.runAsync(
    `INSERT INTO sync_queue(id,entity_type,entity_id,operation,idempotency_key,payload_hash,payload,base_version,status,created_at,updated_at,local_revision) VALUES(?,'workout_plan',?,'upsert',?,?,?,?,'pending',?,?,?)`,
    Crypto.randomUUID(),
    plan.id,
    Crypto.randomUUID(),
    hash,
    JSON.stringify(mutation),
    baseVersion,
    now,
    now,
    next,
  );
}

/** Recover a lost unsent source from the frozen session; never rewrite a published plan. */
async function recoverLegacyPlanDependencies(database: Database) {
  await localTransaction(database, async (tx) => {
    const sessions = await tx.getAllAsync<{ id: string; plan_id: string; payload: string }>(
      'SELECT id,plan_id,payload FROM sessions WHERE source_plan_revision_id IS NULL AND pending=1 ORDER BY updated_at,id',
    );
    const groups = new Map<string, typeof sessions>();
    for (const row of sessions) {
      const payload = JSON.parse(row.payload) as { planVersion: number };
      if (payload.planVersion !== 0) continue;
      groups.set(row.plan_id, [...(groups.get(row.plan_id) ?? []), row]);
    }
    for (const [planId, rows] of groups) {
      const plan = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id=?', planId);
      if (!plan) continue;
      if (plan.version > 0 || plan.conflict_operation_id) {
        for (const row of rows)
          await tx.runAsync(
            'UPDATE sessions SET dependency_error=? WHERE id=?',
            'A revisão original ainda não foi vinculada. Nenhuma associação à ficha atual será feita sem confirmação da origem.',
            row.id,
          );
        continue;
      }
      const live = mapPlan(plan);
      await tx.runAsync(
        "UPDATE sync_queue SET status='superseded',updated_at=? WHERE entity_type='workout_plan' AND entity_id=? AND status IN ('pending','in_flight','error')",
        new Date().toISOString(),
        planId,
      );
      await tx.runAsync('UPDATE plans SET origin_revision_id=NULL WHERE id=?', planId);
      let previousContent = '';
      let previousOrigin: string | null = null;
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as { planSnapshot: unknown };
        const source = planSyncPayloadSchema.parse(payload.planSnapshot);
        if (source.id !== planId) throw new Error('Origem offline incompatível.');
        const content = canonicalPlanContent(source);
        if (content !== previousContent) {
          await commitInTransaction(tx, { ...live, ...source }, null);
          previousOrigin = (await tx.getFirstAsync<{ origin_revision_id: string }>(
            'SELECT origin_revision_id FROM plans WHERE id=?',
            planId,
          ))!.origin_revision_id;
          previousContent = content;
        }
        await tx.runAsync(
          'UPDATE sessions SET source_plan_revision_id=?,dependency_error=NULL WHERE id=?',
          previousOrigin,
          row.id,
        );
      }
      if (previousContent !== canonicalPlanContent(live)) await commitInTransaction(tx, live, null);
    }
  });
}

async function refreshPlans(database: Database): Promise<void> {
  const captured = await captureRevisions(database, 'workout_plan');
  const remote: PlanView[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await listPlansRequest(page, true);
    remote.push(...result.items);
    if (remote.length >= result.total || result.items.length === 0) {
      break;
    }
  }
  for (const plan of remote)
    await localTransaction(database, async (tx) => {
      if (
        await canApplyRemote(
          tx,
          'workout_plan',
          plan.id,
          captured.get(plan.id)?.local_revision ?? 0,
          plan.version,
        )
      )
        await writeServerPlan(tx, plan);
    });
}

async function writeServerPlan(database: Database, plan: PlanView): Promise<void> {
  const payload = JSON.parse(JSON.stringify(planSyncPayloadSchema.parse(plan))) as PlanSyncPayload;
  await database.runAsync(
    `INSERT INTO plans (
      id, name, description, accent, status, version, payload, updated_at, pending, synced, conflict_operation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, NULL)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      accent = excluded.accent,
      status = excluded.status,
      version = excluded.version,
      payload = excluded.payload,
      updated_at = excluded.updated_at,
      pending = 0,
      synced = 1,
      conflict_operation_id = NULL,
      origin_revision_id = CASE WHEN EXISTS(SELECT 1 FROM local_plan_revisions r WHERE r.id=plans.origin_revision_id AND r.server_version=excluded.version) THEN plans.origin_revision_id ELSE NULL END`,
    payload.id,
    payload.name,
    payload.description,
    payload.accent ?? null,
    payload.status,
    plan.version,
    JSON.stringify(plan),
    plan.updatedAt,
  );
}

function mapPlan(row: PlanRow): LocalPlan {
  const payload = planSyncPayloadSchema.parse(JSON.parse(row.payload));
  return {
    ...payload,
    originRevisionId: row.origin_revision_id ?? null,
    officialSnapshot: planSchema.safeParse(JSON.parse(row.payload)).success
      ? planSchema.parse(JSON.parse(row.payload))
      : undefined,
    version: row.version,
    pending: row.pending === 1,
    synced: row.synced === 1,
    conflictOperationId: row.conflict_operation_id,
    updatedAt: row.updated_at,
  };
}

function blankPlan(
  id: string,
  input: { name: string; description: string | null; accent: LocalPlan['accent'] },
): LocalPlan {
  return {
    id,
    name: input.name,
    description: input.description,
    accent: input.accent,
    status: 'active',
    exercises: [],
    version: 0,
    pending: true,
    synced: false,
    conflictOperationId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyPlanSet(): PlanExerciseInput['sets'][number] {
  return {
    id: Crypto.randomUUID(),
    setIndex: 1,
    kind: 'normal',
    repetitions: null,
    load: null,
    loadUnit: 'kg',
    loadType: 'fixed',
    durationSeconds: null,
    restSeconds: null,
    notes: null,
  };
}
