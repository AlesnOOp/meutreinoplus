import {
  canonicalJsonString,
  canonicalPlanContent,
  planSchema,
  planSyncMutationSchema,
  planSyncPayloadSchema,
  type PlanExerciseInput,
  type PlanSyncPayload,
  type PlanView,
  planReconcileRequestSchema,
  type PlanReconcileResult,
} from '@meutreino/shared';
import * as Crypto from 'expo-crypto';
import { pushCatalogSync } from '@/api/catalog';
import { isNetworkError } from '@/api/errors';
import {
  getPlanRequest,
  reconcilePlanConflictRequest,
  listPlansRequest,
  resolvePlanConflictRequest,
} from '@/api/plans';
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
  reconciliationPending?: boolean;
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
  const reconciliation = await database.getFirstAsync(
    'SELECT id FROM local_plan_reconciliations WHERE plan_id=? AND result IS NULL',
    planId,
  );
  return {
    ...mapPlan(row),
    resolutionPendingChoice: intent?.choice,
    reconciliationPending: Boolean(reconciliation),
  };
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
          const flagged = await localTransaction(database, async (tx) => {
            const active = await tx.getFirstAsync<{ status: string }>(
              'SELECT status FROM sync_queue WHERE id=?',
              row.id,
            );
            if (!active || ['done', 'superseded'].includes(active.status)) return false;
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
            return item.status === 'conflict';
          });
          conflicts += flagged ? 1 : 0;
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
    if (
      await tx.getFirstAsync(
        'SELECT id FROM local_plan_reconciliations WHERE plan_id=? AND result IS NULL',
        planId,
      )
    )
      throw new Error('Retome a reconciliação pendente antes de escolher outra decisão.');
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

export async function reconcileLocalPlanConflict(
  userId: string,
  planId: string,
  choice: 'keep_server' | 'keep_both',
  descendants: 'archive' | 'reapply',
  sourceOriginId: string | null = null,
  expectedVersion?: number,
  resumeOnly = false,
  previewOriginId?: string,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  let pending = await database.getFirstAsync<{ id: string; conflict_id: string; request: string }>(
    'SELECT * FROM local_plan_reconciliations WHERE plan_id=? AND result IS NULL',
    planId,
  );
  if (!pending) {
    if (resumeOnly)
      throw new Error(
        'Não existe decisão pendente. Reabra a ficha e confirme uma nova prévia antes de escolher novamente.',
      );
    const remote = expectedVersion ? { version: expectedVersion } : await getPlanRequest(planId);
    pending = await localTransaction(database, async (tx) => {
      const running = await tx.getFirstAsync<{ id: string; conflict_id: string; request: string }>(
        'SELECT * FROM local_plan_reconciliations WHERE plan_id=? AND result IS NULL',
        planId,
      );
      if (running) return running;
      if (await readPlanConflictIntent(tx, planId))
        throw new Error('Retome a decisão anterior antes de reconciliar.');
      const row = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id=?', planId);
      if (!row?.conflict_operation_id) throw new Error('Não existe conflito aberto nesta ficha.');
      if (previewOriginId && row.origin_revision_id !== previewOriginId)
        throw new Error(
          'A edição local mudou durante a prévia. Reabra a ficha e confirme novamente; nada foi reconciliado.',
        );
      const root = await tx.getFirstAsync<{ payload: string }>(
        'SELECT payload FROM sync_queue WHERE id=?',
        row.conflict_operation_id,
      );
      const source = root ? planSyncMutationSchema.parse(JSON.parse(root.payload)) : null;
      const graph = await inspectPlanConflictDependencies(
        tx,
        planId,
        row.conflict_operation_id,
        source?.revisionOrigin?.id ?? null,
      );
      if (graph.missingOrigin || !source?.revisionOrigin || graph.unknownOperations.length)
        throw new Error(
          'A cadeia não possui provas suficientes. Preserve o aparelho e solicite recuperação assistida.',
        );
      const affected = new Set(graph.revisions.filter((r) => !r.server_version).map((r) => r.id));
      if (
        graph.sessions.some(
          (s) => !s.source_plan_revision_id || affected.has(s.source_plan_revision_id),
        )
      )
        throw new Error(
          'Há treino dependente de revisão não publicada. Escolha “Manter a versão deste aparelho”; importar histórico não está autorizado.',
        );
      const operations = graph.operations.map((op) => ({
        id: op.id,
        entityType: 'workout_plan',
        entityId: op.entity_id,
        operation: op.operation,
        idempotencyKey: op.idempotency_key,
        payloadHash: op.payload_hash,
        baseVersion: op.base_version,
        createdAt: op.created_at,
        payload: JSON.parse(op.payload),
      }));
      const request = planReconcileRequestSchema.parse({
        id: Crypto.randomUUID(),
        choice,
        descendants,
        sourceOriginId,
        expectedVersion: remote.version,
        operations,
      });
      if (descendants === 'reapply' && !graph.descendants.some((r) => r.id === sourceOriginId))
        throw new Error('Selecione uma edição posterior da prévia para reaplicar.');
      await tx.runAsync(
        'INSERT INTO local_plan_reconciliations(id,plan_id,conflict_id,request,created_at) VALUES(?,?,?,?,?)',
        request.id,
        planId,
        row.conflict_operation_id,
        JSON.stringify(request),
        new Date().toISOString(),
      );
      return {
        id: request.id,
        conflict_id: row.conflict_operation_id,
        request: JSON.stringify(request),
      };
    });
  }
  const request = planReconcileRequestSchema.parse(JSON.parse(pending.request));
  let result: PlanReconcileResult;
  try {
    result = await reconcilePlanConflictRequest(pending.conflict_id, request);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'reconciliation_stale'
    ) {
      await localTransaction(database, async (tx) => {
        await tx.runAsync(
          'UPDATE local_plan_reconciliations SET result=? WHERE id=? AND result IS NULL',
          JSON.stringify({ outcome: 'rejected', code: 'reconciliation_stale' }),
          request.id,
        );
      });
      throw new Error(
        'A ficha mudou antes da decisão e nada foi reconciliado. Reabra a ficha para revisar a versão atual e escolher novamente.',
      );
    }
    throw new Error(
      'A reconciliação não foi confirmada. Reabra esta ficha e use “Retomar reconciliação”. Não troque a decisão nem apague os dados. Se outro aparelho já resolveu o conflito ou a recusa persistir, solicite recuperação assistida.',
    );
  }
  if (
    result.id !== pending.id ||
    result.choice !== request.choice ||
    result.closed.length !== request.operations.length ||
    request.operations.some((op) => !result.closed.some((item) => item.id === op.id))
  )
    throw new Error('Recibo incompatível; preserve os dados e retome a decisão.');
  if (
    result.plan.id !== planId ||
    (request.choice === 'keep_both'
      ? !result.preservedPlan || result.preservedPlan.id === planId
      : result.preservedPlan !== null) ||
    (request.descendants === 'reapply') !== Boolean(result.derived)
  )
    throw new Error('Recibo incompatível com a decisão; preserve os dados e retome.');
  if (result.derived) {
    const d = result.derived;
    const source = request.operations.find(
      (op) => op.payload.revisionOrigin?.id === request.sourceOriginId,
    );
    const target = request.choice === 'keep_both' ? result.preservedPlan! : result.plan;
    if (
      !source ||
      d.sourceOriginId !== request.sourceOriginId ||
      d.operation.entityId !== target.id ||
      d.revision.originId !== d.operation.payload.revisionOrigin?.id ||
      d.operation.payload.revisionOrigin?.parentId !== null ||
      d.revision.version !== d.revision.snapshot.version ||
      canonicalPlanContent(d.operation.payload) !== canonicalPlanContent(d.revision.snapshot)
    )
      throw new Error('A nova edição não confirma sua origem. Preserve os dados e retome.');
    const mapped = {
      ...source.payload,
      id: d.operation.payload.id,
      exercises: source.payload.exercises.map((ex, i) => ({
        ...ex,
        id: d.operation.payload.exercises[i]?.id ?? ex.id,
        sets: ex.sets.map((set, j) => ({
          ...set,
          id: d.operation.payload.exercises[i]?.sets[j]?.id ?? set.id,
        })),
      })),
    };
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      canonicalJsonString(d.operation.payload),
    );
    if (
      hash !== d.operation.payloadHash ||
      canonicalPlanContent(mapped) !== canonicalPlanContent(d.operation.payload)
    )
      throw new Error(
        'A prescrição reaplicada diverge da edição escolhida. Nada foi confirmado localmente.',
      );
  }
  await localTransaction(database, async (tx) => {
    const intent = await tx.getFirstAsync<{ result: string | null }>(
      'SELECT result FROM local_plan_reconciliations WHERE id=?',
      request.id,
    );
    if (intent?.result) return;
    for (const op of request.operations)
      await tx.runAsync(
        "UPDATE sync_queue SET status=CASE WHEN status='done' OR ?=1 THEN 'done' ELSE 'superseded' END,last_error=NULL,updated_at=? WHERE id=?",
        result.closed.find((item) => item.id === op.id)?.status === 'applied' ? 1 : 0,
        new Date().toISOString(),
        op.id,
      );
    const promoted = new Set<string>();
    for (const plan of [result.plan, result.preservedPlan]) {
      if (
        plan &&
        (await applyReconciledPlan(
          tx,
          plan,
          pending.conflict_id,
          request.operations.map((op) => op.payload.revisionOrigin?.id ?? null),
        ))
      )
        promoted.add(plan.id);
    }
    if (result.derived) {
      const d = result.derived;
      const next = await nextPlanLocalRevision(tx, d.operation.entityId);
      await tx.runAsync(
        'INSERT INTO local_plan_revisions(id,plan_id,local_revision,snapshot,parent_id,base_version,server_version,official_snapshot,created_at) VALUES(?,?,?,?,NULL,?,?,?,?)',
        d.revision.originId,
        d.operation.entityId,
        next,
        JSON.stringify(planSyncPayloadSchema.parse(d.operation.payload)),
        d.operation.baseVersion,
        d.revision.version,
        JSON.stringify(d.revision.snapshot),
        d.operation.createdAt,
      );
      await tx.runAsync(
        'INSERT INTO local_plan_derivations(origin_id,source_origin_id,decision_id,created_at) VALUES(?,?,?,?)',
        d.revision.originId,
        d.sourceOriginId,
        request.id,
        new Date().toISOString(),
      );
      await tx.runAsync(
        "INSERT INTO sync_queue(id,entity_type,entity_id,operation,idempotency_key,payload_hash,payload,base_version,status,created_at,updated_at,local_revision) VALUES(?,'workout_plan',?,'upsert',?,?,?,?,'done',?,?,?)",
        d.operation.id,
        d.operation.entityId,
        d.operation.idempotencyKey,
        d.operation.payloadHash,
        JSON.stringify(d.operation.payload),
        d.operation.baseVersion,
        d.operation.createdAt,
        d.operation.createdAt,
        next,
      );
      // E may be acknowledged after F already exists on Q. Record E as history,
      // but only install it as the live origin when its snapshot was promoted.
      if (promoted.has(d.operation.entityId))
        await tx.runAsync(
          'UPDATE plans SET local_revision=?,acknowledged_revision=?,origin_revision_id=? WHERE id=?',
          next,
          next,
          d.revision.originId,
          d.operation.entityId,
        );
    }
    await tx.runAsync(
      'UPDATE local_plan_reconciliations SET result=? WHERE id=?',
      JSON.stringify(result),
      request.id,
    );
  });
}

/** A receipt confirms an earlier write; it is not a refresh that can discard a successor. */
async function applyReconciledPlan(
  tx: Database,
  plan: PlanView,
  conflictId: string,
  closedOrigins: (string | null)[],
): Promise<boolean> {
  const current = await tx.getFirstAsync<PlanRow>('SELECT * FROM plans WHERE id=?', plan.id);
  const active = await tx.getFirstAsync(
    "SELECT id FROM sync_queue WHERE entity_type='workout_plan' AND entity_id=? AND status IN ('pending','in_flight','error') LIMIT 1",
    plan.id,
  );
  const isClosedOrigin = Boolean(
    current?.origin_revision_id && closedOrigins.includes(current.origin_revision_id),
  );
  const unrelatedConflict =
    current?.conflict_operation_id && current.conflict_operation_id !== conflictId;
  if (
    active ||
    unrelatedConflict ||
    (current &&
      (current.version > plan.version ||
        (current.pending === 1 && !isClosedOrigin) ||
        (current.version === plan.version &&
          !isClosedOrigin &&
          canonicalPlanContent(JSON.parse(current.payload)) !== canonicalPlanContent(plan))))
  ) {
    await tx.runAsync(
      'UPDATE plans SET stale_remote_version=MAX(COALESCE(stale_remote_version,0),?) WHERE id=?',
      plan.version,
      plan.id,
    );
    return false;
  }
  await writeServerPlan(tx, plan);
  return true;
}

/** Historical ACKs can append a ledger entry without changing the live revision.
 * Future edits must allocate after BOTH counters to avoid reusing that entry's key. */
async function nextPlanLocalRevision(tx: Database, planId: string): Promise<number> {
  const row = await tx.getFirstAsync<{ next: number }>(
    'SELECT MAX(COALESCE((SELECT local_revision FROM plans WHERE id=?),0),COALESCE((SELECT MAX(local_revision) FROM local_plan_revisions WHERE plan_id=?),0))+1 AS next',
    planId,
    planId,
  );
  return row!.next;
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
  const next = await nextPlanLocalRevision(database, plan.id);
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
