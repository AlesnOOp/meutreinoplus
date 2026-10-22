import {
  canonicalJsonString,
  canonicalPlanContent,
  rebaseSessionEdits,
  sessionResolutionSchema,
  sessionConflictResolveSchema,
  effectiveSet,
  sessionPlanSnapshotSchema,
  sessionSyncPayloadSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { ApiClientError, isNetworkError } from '@/api/errors';
import {
  getSessionRequest,
  listSessionPageRequest,
  openSessionRequest,
  pushSessionSync,
  resolveSessionConflictRequest,
  previewSessionConflictRequest,
  sessionVariantsRequest,
  startSessionRequest,
} from '@/api/sessions';
import { openLocalDatabase } from '@/db/local-database';
import {
  acknowledge,
  canApplyRemote,
  captureRevisions,
  claimOperations,
  hasPending,
  localTransaction,
  releaseOperations,
  revision,
  singleSync,
} from '@/db/sync-state';
import { getPlanRevisionRequest } from '@/api/plans';
import { readLocalPlan, syncPlans } from '@/plans/plan-store';

type Database = Awaited<ReturnType<typeof openLocalDatabase>>;

type SessionRow = {
  id: string;
  status: string;
  plan_id: string;
  plan_name: string;
  server_version: number;
  payload: string;
  updated_at: string;
  pending: number;
  synced: number;
  conflict_operation_id: string | null;
  local_revision: number;
  acknowledged_revision: number;
  dependency_error: string | null;
};

export type LocalSession = SessionSyncPayload & {
  serverVersion: number;
  dependencyError: string | null;
  pending: boolean;
  synced: boolean;
  conflictOperationId: string | null;
};

export async function readOpenLocalSession(userId: string): Promise<LocalSession | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions WHERE status IN ('in_progress', 'paused') ORDER BY updated_at DESC LIMIT 1`,
  );
  return row ? mapSession(row) : null;
}

export async function readLocalSession(
  userId: string,
  sessionId: string,
): Promise<LocalSession | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions WHERE id = ?`,
    sessionId,
  );
  return row ? mapSession(row) : null;
}

export async function listLocalSessions(userId: string): Promise<LocalSession[]> {
  const database = await openLocalDatabase(userId);
  const rows = await database.getAllAsync<SessionRow>(
    `SELECT * FROM sessions ORDER BY updated_at DESC`,
  );
  return rows.map(mapSession);
}

export async function startLocalSession(
  userId: string,
  planId: string,
  gym: { id: string; name: string } | null,
  online: boolean,
): Promise<LocalSession> {
  const open = await readOpenLocalSession(userId);
  if (open) {
    return open;
  }
  const synced = online
    ? await syncPlans(userId).catch(() => ({ synced: false, conflicts: 0 }))
    : { synced: false, conflicts: 0 };
  const plan = await readLocalPlan(userId, planId);
  if (!plan || plan.status !== 'active') {
    throw new Error('Ficha não encontrada.');
  }
  const now = new Date().toISOString();
  const snapshot = sessionPlanSnapshotSchema.parse(
    (!plan.pending ? plan.officialSnapshot : undefined) ?? {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      accent: plan.accent,
      status: plan.status,
      version: plan.pending ? 0 : plan.version,
      duplicatedFromId: null,
      createdAt: plan.updatedAt,
      updatedAt: plan.updatedAt,
      archivedAt: null,
      exercises: plan.exercises,
    },
  );
  const sessionId = Crypto.randomUUID();
  const exerciseSessions = snapshot.exercises.map((exercise) => {
    const equipment = gym ? exercise.equipment.find((item) => item.gymId === gym.id) : undefined;
    return {
      id: Crypto.randomUUID(),
      planExerciseId: exercise.id,
      exerciseId: exercise.exerciseId,
      name: (exercise.exerciseName ?? 'Exercício').slice(0, 160),
      orderIndex: exercise.orderIndex,
      status: 'pending' as const,
      skipReason: null,
      gymName: gym?.name ?? null,
      equipmentName: equipment?.equipmentName ?? null,
      machineNumber: equipment?.machineNumber ?? null,
      restSeconds: exercise.restSeconds,
    };
  });
  const local = sessionSyncPayloadSchema.parse({
    id: sessionId,
    planId: plan.id,
    planVersion: plan.pending ? 0 : Math.max(plan.version, 0),
    planName: snapshot.name,
    gymId: gym?.id ?? null,
    gymName: gym?.name ?? null,
    status: 'in_progress',
    startedAt: now,
    endedAt: null,
    notes: null,
    planSnapshot: snapshot,
    exerciseSessions,
    performedSets: [],
    corrections: [],
    feedback: [],
    timeEvents: [],
  });
  await persist(userId, local, 0, true, plan.originRevisionId ?? null);
  if (!online || !synced.synced || synced.conflicts > 0) {
    return (await readLocalSession(userId, sessionId))!;
  }
  const startedRevision = (await revision(
    await openLocalDatabase(userId),
    'workout_session',
    sessionId,
  ))!.local_revision;
  try {
    const remote = await startSessionRequest({
      id: sessionId,
      planId: plan.id,
      gymId: gym?.id ?? null,
      startedAt: now,
      exerciseSessions: exerciseSessions.map((exercise) => ({
        id: exercise.id,
        planExerciseId: exercise.planExerciseId,
      })),
    });
    const database = await openLocalDatabase(userId);
    await localTransaction(database, async (tx) => {
      await tx.runAsync(
        `UPDATE sessions SET server_version = MAX(server_version, ?) WHERE id = ?`,
        remote.version,
        sessionId,
      );
      const current = await revision(tx, 'workout_session', sessionId);
      if (current?.local_revision === startedRevision) {
        // This REST call created only the initial state; confirm only that revision's queue row.
        await tx.runAsync(
          `UPDATE sync_queue SET status = 'done' WHERE entity_type = 'workout_session' AND entity_id = ? AND local_revision = ?`,
          sessionId,
          startedRevision,
        );
        await tx.runAsync(
          `UPDATE sessions SET pending = 0, synced = 1, acknowledged_revision = ? WHERE id = ?`,
          startedRevision,
          sessionId,
        );
      }
      await tx.runAsync(
        `UPDATE sync_queue SET base_version = ? WHERE entity_type = 'workout_session' AND entity_id = ? AND status = 'pending' AND attempt_count = 0`,
        remote.version,
        sessionId,
      );
    });
    await applyRemoteSession(userId, remote.payload, remote.version, startedRevision);
    return (await readLocalSession(userId, remote.payload.id))!;
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'session_open') {
      const remote = await openSessionRequest();
      if (remote.session) {
        await applyRemoteSession(userId, remote.session.payload, remote.session.version, 0);
        const database = await openLocalDatabase(userId);
        await localTransaction(database, async (tx) => {
          if (
            (await revision(tx, 'workout_session', sessionId))?.local_revision === startedRevision
          ) {
            await discardLocal(tx, sessionId);
          }
        });
        if (await readLocalSession(userId, sessionId))
          return (await readLocalSession(userId, sessionId))!;
        return (await readLocalSession(userId, remote.session.payload.id))!;
      }
    }
    if (isNetworkError(error)) {
      return (await readLocalSession(userId, sessionId))!;
    }
    return (await readLocalSession(userId, sessionId))!;
  }
}

export async function recordLocalSet(
  userId: string,
  sessionId: string,
  input: {
    exerciseSessionId: string;
    plannedSetId: string | null;
    repetitions: number | null;
    load: string | null;
    loadUnit: 'kg' | 'lb' | null;
    outcome: 'completed' | 'skipped';
  },
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    const exercise = session.exerciseSessions.find((item) => item.id === input.exerciseSessionId);
    if (!exercise) {
      throw new Error('Exercício não encontrado.');
    }
    const plannedExercise = session.planSnapshot.exercises.find(
      (item) => item.id === exercise.planExerciseId,
    );
    const planned = input.plannedSetId
      ? plannedExercise?.sets.find((set) => set.id === input.plannedSetId)
      : undefined;
    const position =
      session.performedSets
        .filter((set) => set.exerciseSessionId === exercise.id)
        .reduce((max, set) => Math.max(max, set.setIndex), 0) + 1;
    session.performedSets.push({
      id: Crypto.randomUUID(),
      exerciseSessionId: exercise.id,
      plannedSetId: planned?.id ?? null,
      setIndex: position,
      plannedRepetitions: planned?.repetitions ?? null,
      plannedLoad: planned?.load ?? null,
      plannedLoadUnit: planned?.loadUnit ?? null,
      repetitions: input.repetitions,
      load: input.load,
      loadUnit: input.loadUnit,
      outcome: input.outcome,
      completedAt: new Date().toISOString(),
      notes: null,
    });
    if (exercise.status === 'pending') {
      exercise.status = 'in_progress';
    }
  });
}

export async function correctLocalSet(
  userId: string,
  sessionId: string,
  setId: string,
  input: {
    repetitions: number | null;
    load: string | null;
    loadUnit: 'kg' | 'lb' | null;
    voided: boolean;
    reason: string;
  },
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    session.corrections.push({
      id: Crypto.randomUUID(),
      performedSetId: setId,
      repetitions: input.voided ? null : input.repetitions,
      load: input.voided ? null : input.load,
      loadUnit: input.voided ? null : input.loadUnit,
      voided: input.voided,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    });
  });
}

export async function markLocalExercise(
  userId: string,
  sessionId: string,
  exerciseSessionId: string,
  status: 'completed' | 'skipped',
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    const exercise = session.exerciseSessions.find((item) => item.id === exerciseSessionId);
    if (!exercise) {
      throw new Error('Exercício não encontrado.');
    }
    exercise.status = status;
    exercise.skipReason = status === 'skipped' ? 'Pulado' : null;
  });
}

export async function saveLocalFeedback(
  userId: string,
  sessionId: string,
  exerciseSessionId: string,
  input: { perceivedLevel: number | null; comment: string | null },
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    const current = session.feedback.find((item) => item.exerciseSessionId === exerciseSessionId);
    if (current) {
      current.perceivedLevel = input.perceivedLevel;
      current.comment = input.comment;
      return;
    }
    session.feedback.push({
      id: Crypto.randomUUID(),
      exerciseSessionId,
      version: 0,
      perceivedLevel: input.perceivedLevel,
      comment: input.comment,
    });
  });
}

export async function pushLocalClock(
  userId: string,
  sessionId: string,
  kind: SessionSyncPayload['timeEvents'][number]['kind'],
  rest?: { durationSeconds: number; exerciseSessionId: string | null },
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    const now = new Date().toISOString();
    if (kind === 'pause' && session.status === 'in_progress') {
      session.status = 'paused';
    }
    if (kind === 'resume' && session.status === 'paused') {
      session.status = 'in_progress';
    }
    session.timeEvents.push({
      id: Crypto.randomUUID(),
      kind,
      occurredAt: now,
      restDurationSeconds: rest?.durationSeconds ?? null,
      exerciseSessionId: rest?.exerciseSessionId ?? null,
    });
  });
}

export async function finishLocalSession(
  userId: string,
  sessionId: string,
  status: 'completed' | 'aborted',
  notes: string | null,
): Promise<LocalSession> {
  return changeSession(userId, sessionId, (session) => {
    session.status = status;
    session.endedAt = new Date().toISOString();
    session.notes = notes;
  });
}

export function syncSessions(userId: string): Promise<{ synced: boolean; conflicts: number }> {
  return singleSync(userId, 'sessions', () => runSessionSync(userId));
}

async function runSessionSync(userId: string): Promise<{ synced: boolean; conflicts: number }> {
  const plans = await syncPlans(userId).catch((error: unknown) => {
    if (isNetworkError(error)) return { synced: false, conflicts: 0 };
    throw error;
  });
  const database = await openLocalDatabase(userId);
  try {
    await retrySessionResolutions(userId);
  } catch (error) {
    if (isNetworkError(error)) return { synced: false, conflicts: plans.conflicts };
    throw error;
  }
  await repairLegacyBindings(database);
  await adoptSyncedPlans(userId, database);
  const queued = await claimOperations(database, ['workout_session']);
  let conflicts = plans.conflicts;
  try {
    if (queued.length) {
      const result = await pushSessionSync(
        queued.map((row) => ({
          id: row.id,
          entityType: 'workout_session',
          entityId: row.entity_id,
          operation: 'upsert',
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
        if (item.code === 'session_open' || item.code === 'plan_not_synced') continue;
        if (item.status === 'applied') {
          await acknowledge(database, row);
          const beforeGet = await revision(database, 'workout_session', row.entity_id);
          const remote = await getSessionRequest(row.entity_id).catch(() => null);
          if (remote) await reconcileFeedbackVersions(database, remote.payload);
          if (remote)
            await applyRemoteSession(
              userId,
              remote.payload,
              remote.version,
              beforeGet?.local_revision ?? 0,
            );
        } else {
          conflicts += item.status === 'conflict' ? 1 : 0;
          await localTransaction(database, async (tx) => {
            const active = await tx.getFirstAsync<{ status: string }>(
              'SELECT status FROM sync_queue WHERE id = ? AND idempotency_key = ?',
              row.id,
              row.idempotency_key,
            );
            if (!active || active.status === 'superseded' || active.status === 'done') return;
            await tx.runAsync(
              `UPDATE sync_queue SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
              item.code ?? item.status,
              new Date().toISOString(),
              item.id,
            );
            if (item.status === 'conflict')
              await tx.runAsync(
                `UPDATE sessions SET conflict_operation_id = ?, pending = 1, synced = 0 WHERE id = ?`,
                item.id,
                row.entity_id,
              );
          });
        }
      }
    }
    await releaseOperations(database, queued);
    const captured = await captureRevisions(database, 'workout_session');
    const remote = await openSessionRequest();
    if (remote.session)
      await applyRemoteSession(
        userId,
        remote.session.payload,
        remote.session.version,
        captured.get(remote.session.payload.id)?.local_revision ?? 0,
      );
    await restoreSessionHistory(userId, database, captured);
  } catch (error) {
    await releaseOperations(database, queued);
    if (isNetworkError(error)) return { synced: false, conflicts };
    throw error;
  }
  return {
    synced:
      plans.synced &&
      !(await hasPending(database, ['workout_session', 'gym', 'equipment', 'exercise'])),
    conflicts,
  };
}

/** Restore existing completed sessions after logout erased the device DB. Never replace dirty rows. */
async function restoreSessionHistory(
  userId: string,
  database: Database,
  captured: Awaited<ReturnType<typeof captureRevisions>>,
) {
  for (let page = 1; ; page++) {
    const result = await listSessionPageRequest(page);
    for (const item of result.items) {
      const current = await database.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id = ?',
        item.id,
      );
      if (
        current &&
        (current.pending || current.conflict_operation_id || current.server_version >= item.version)
      )
        continue;
      const remote = await getSessionRequest(item.id);
      await applyRemoteSession(
        userId,
        remote.payload,
        remote.version,
        captured.get(item.id)?.local_revision ?? 0,
      );
    }
    if (page * result.pageSize >= result.total || result.items.length === 0) break;
  }
}

type ResolutionChoice = 'keep_remote' | 'keep_server' | 'keep_local' | 'keep_both';
type ResolutionIntent = {
  id: string;
  session_id: string;
  conflict_id: string;
  local_revision: number;
  request: string;
  status: string;
};
export async function previewLocalSessionConflict(
  userId: string,
  sessionId: string,
  choice: ResolutionChoice,
) {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE id = ?',
    sessionId,
  );
  if (!row?.conflict_operation_id) throw new Error('Conflito não encontrado.');
  const payload = sessionSyncPayloadSchema.parse(JSON.parse(row.payload));
  let preview: Awaited<ReturnType<typeof previewSessionConflictRequest>>;
  try {
    preview = await previewSessionConflictRequest(row.conflict_operation_id, {
      choice,
      localRevision: row.local_revision,
      payload,
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'conflict_already_resolved')
      await requeueClosedConflict(database, row.id, row.conflict_operation_id, row.server_version);
    throw error;
  }
  return { preview, payload, conflictId: row.conflict_operation_id };
}

export async function resolveLocalSessionConflict(
  userId: string,
  sessionId: string,
  choice: ResolutionChoice,
  decision?: Awaited<ReturnType<typeof previewLocalSessionConflict>>,
) {
  const database = await openLocalDatabase(userId);
  const previous = await database.getFirstAsync<ResolutionIntent>(
    "SELECT * FROM session_resolution_intents WHERE session_id = ? AND status = 'pending'",
    sessionId,
  );
  if (previous) {
    await sendResolutionIntent(userId, previous);
    return;
  }
  const reviewed = decision ?? (await previewLocalSessionConflict(userId, sessionId, choice));
  if (
    (choice === 'keep_remote' || choice === 'keep_server') &&
    reviewed.preview.changes.length &&
    !decision
  )
    throw new Error('Revise as diferenças e confirme, ou preserve ambas as versões.');
  const request = sessionConflictResolveSchema.parse({
    choice,
    payload: reviewed.payload,
    localRevision: reviewed.preview.localRevision,
    expectedVersion: reviewed.preview.remoteVersion,
    previewHash: reviewed.preview.previewHash,
    idempotencyKey: Crypto.randomUUID(),
    confirmDiscard: !!decision,
  });
  const intent: ResolutionIntent = {
    id: request.idempotencyKey,
    session_id: sessionId,
    conflict_id: reviewed.conflictId,
    local_revision: request.localRevision,
    request: JSON.stringify(request),
    status: 'pending',
  };
  await localTransaction(database, async (tx) => {
    const row = await tx.getFirstAsync<SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
      sessionId,
    );
    if (
      row?.conflict_operation_id !== intent.conflict_id ||
      row.local_revision !== intent.local_revision
    )
      throw new Error('O treino mudou durante a revisão. Revise novamente.');
    await tx.runAsync(
      "INSERT INTO session_resolution_intents(id,session_id,conflict_id,local_revision,request,status,created_at) VALUES(?,?,?,?,?,'pending',?)",
      intent.id,
      sessionId,
      intent.conflict_id,
      intent.local_revision,
      intent.request,
      new Date().toISOString(),
    );
  });
  await sendResolutionIntent(userId, intent);
}

async function sendResolutionIntent(userId: string, intent: ResolutionIntent) {
  const database = await openLocalDatabase(userId);
  const request = sessionConflictResolveSchema.parse(JSON.parse(intent.request));
  let remote: z.infer<typeof sessionResolutionSchema>;
  try {
    remote = await resolveSessionConflictRequest(intent.conflict_id, request);
  } catch (error) {
    if (
      error instanceof ApiClientError &&
      [
        'resolution_stale',
        'conflict_already_resolved',
        'incompatible_session',
        'idempotency_key_reused',
        'confirmation_required',
      ].includes(error.code)
    ) {
      await localTransaction(database, async (tx) => {
        await tx.runAsync(
          "UPDATE session_resolution_intents SET status = 'requires_review', result = ? WHERE id = ? AND status = 'pending'",
          JSON.stringify({ code: error.code, message: error.message }),
          intent.id,
        );
        if (error.code === 'conflict_already_resolved') {
          await requeueClosedConflictInTransaction(
            tx,
            intent.session_id,
            intent.conflict_id,
            request.expectedVersion,
          );
        }
      });
    }
    throw error;
  }
  // A committed server decision is acknowledged once; later local edits are a separate operation.
  await localTransaction(database, async (tx) => {
    const saved = await tx.getFirstAsync<ResolutionIntent>(
      'SELECT * FROM session_resolution_intents WHERE id = ?',
      intent.id,
    );
    if (saved?.status !== 'pending') return;
    const latest = await tx.getFirstAsync<SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
      intent.session_id,
    );
    if (!latest) throw new Error('Treino local não encontrado.');
    await tx.runAsync(
      "UPDATE session_resolution_intents SET status = 'applied', result = ? WHERE id = ?",
      JSON.stringify(remote),
      intent.id,
    );
    await tx.runAsync(
      "UPDATE sync_queue SET status = 'superseded', updated_at = ? WHERE entity_type = 'workout_session' AND entity_id = ? AND status <> 'done'",
      new Date().toISOString(),
      intent.session_id,
    );
    if (latest.local_revision === intent.local_revision) {
      await writeSession(tx, remote.payload, remote.version, false, latest.local_revision, null);
    } else {
      const newer = sessionSyncPayloadSchema.parse(JSON.parse(latest.payload));
      const rebased = rebaseSessionEdits(request.payload, newer, remote.payload);
      const payload = rebased ?? newer;
      await writeSession(tx, payload, remote.version, true, latest.local_revision, null);
      // Unsafe rebase gets an explicitly stale base, forcing a NEW conflict without losing the newer payload.
      await enqueueSession(
        tx,
        payload,
        rebased ? remote.version : request.expectedVersion,
        latest.local_revision,
      );
    }
    await tx.runAsync(
      'UPDATE sessions SET acknowledged_revision = MAX(acknowledged_revision, ?), conflict_operation_id = NULL WHERE id = ?',
      intent.local_revision,
      intent.session_id,
    );
  });
  await refreshSessionVariants(userId, intent.session_id).catch(() => undefined);
}

async function requeueClosedConflict(
  database: Database,
  sessionId: string,
  conflictId: string,
  base: number,
) {
  await localTransaction(database, (tx) =>
    requeueClosedConflictInTransaction(tx, sessionId, conflictId, base),
  );
}
async function requeueClosedConflictInTransaction(
  tx: Database,
  sessionId: string,
  conflictId: string,
  base: number,
) {
  const latest = await tx.getFirstAsync<SessionRow>(
    'SELECT * FROM sessions WHERE id = ?',
    sessionId,
  );
  if (latest?.conflict_operation_id !== conflictId) return;
  await tx.runAsync(
    "UPDATE sync_queue SET status = 'superseded', updated_at = ? WHERE entity_type = 'workout_session' AND entity_id = ? AND status <> 'done'",
    new Date().toISOString(),
    sessionId,
  );
  await enqueueSession(
    tx,
    sessionSyncPayloadSchema.parse(JSON.parse(latest.payload)),
    base,
    latest.local_revision,
  );
  await tx.runAsync(
    'UPDATE sessions SET conflict_operation_id = NULL, pending = 1, synced = 0 WHERE id = ?',
    sessionId,
  );
}

export async function retrySessionResolutions(userId: string) {
  const database = await openLocalDatabase(userId);
  const intents = await database.getAllAsync<ResolutionIntent>(
    "SELECT * FROM session_resolution_intents WHERE status = 'pending' ORDER BY created_at",
  );
  for (const intent of intents) await sendResolutionIntent(userId, intent);
}
export async function refreshSessionVariants(userId: string, sessionId: string) {
  const rows = await sessionVariantsRequest(sessionId);
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    for (const row of rows)
      await tx.runAsync(
        'INSERT INTO session_variants(id,session_id,payload) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
        row.id,
        sessionId,
        JSON.stringify(row),
      );
  });
  return rows;
}
export async function readSessionVariants(userId: string, sessionId: string) {
  const database = await openLocalDatabase(userId);
  const rows = await database.getAllAsync<{ payload: string }>(
    'SELECT payload FROM session_variants WHERE session_id = ? ORDER BY rowid',
    sessionId,
  );
  return rows.map(
    (row) => JSON.parse(row.payload) as Awaited<ReturnType<typeof sessionVariantsRequest>>[number],
  );
}

export function visibleSets(session: SessionSyncPayload, exerciseSessionId: string) {
  return session.performedSets
    .filter((set) => set.exerciseSessionId === exerciseSessionId)
    .map((set) => effectiveSet(set, session.corrections))
    .filter((set) => !set.voided);
}

async function changeSession(
  userId: string,
  sessionId: string,
  change: (session: SessionSyncPayload) => void,
): Promise<LocalSession> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    const row = await tx.getFirstAsync<SessionRow>(
      `SELECT * FROM sessions WHERE id = ?`,
      sessionId,
    );
    if (!row) throw new Error('Treino não encontrado.');
    const current = mapSession(row);
    if (current.status === 'completed' || current.status === 'aborted')
      throw new Error('Este treino já foi encerrado.');
    change(current);
    await persistLocal(tx, userId, sessionSyncPayloadSchema.parse(current), current.serverVersion);
  });
  return (await readLocalSession(userId, sessionId))!;
}

async function persist(
  userId: string,
  payload: SessionSyncPayload,
  serverVersion: number,
  _queue: boolean,
  sourceRevisionId: string | null = null,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, (tx) =>
    persistLocal(tx, userId, payload, serverVersion, sourceRevisionId),
  );
}

async function writeSession(
  database: Database,
  payload: SessionSyncPayload,
  serverVersion: number,
  pending: boolean,
  localRevision: number,
  conflictId: string | null,
): Promise<void> {
  const stored = sessionSyncPayloadSchema.parse(payload);
  await database.runAsync(
    `INSERT INTO sessions (
      id,status,plan_id,plan_name,server_version,payload,updated_at,pending,synced,conflict_operation_id,local_revision
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      status=excluded.status, plan_name=excluded.plan_name, server_version=excluded.server_version,
      payload=excluded.payload, updated_at=excluded.updated_at, pending=excluded.pending, synced=excluded.synced,
      conflict_operation_id=excluded.conflict_operation_id, local_revision=excluded.local_revision`,
    stored.id,
    stored.status,
    stored.planId,
    stored.planName,
    serverVersion,
    JSON.stringify(stored),
    new Date().toISOString(),
    pending ? 1 : 0,
    pending ? 0 : 1,
    conflictId,
    localRevision,
  );
}

async function persistLocal(
  database: Database,
  userId: string,
  payload: SessionSyncPayload,
  serverVersion: number,
  sourceRevisionId: string | null = null,
): Promise<void> {
  const existing = await database.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions WHERE id = ?`,
    payload.id,
  );
  const next = (existing?.local_revision ?? 0) + 1;
  await writeSession(
    database,
    payload,
    Math.max(serverVersion, existing?.server_version ?? 0),
    true,
    next,
    existing?.conflict_operation_id ?? null,
  );
  if (sourceRevisionId)
    await database.runAsync(
      'UPDATE sessions SET source_plan_revision_id = ? WHERE id = ?',
      sourceRevisionId,
      payload.id,
    );
  if (!existing?.conflict_operation_id) {
    const ready = await readyPayload(userId, payload, database);
    if (ready)
      await enqueueSession(database, ready, existing?.server_version ?? serverVersion, next);
  }
}

async function enqueueSession(
  database: Database,
  stored: SessionSyncPayload,
  serverVersion: number,
  localRevision: number,
): Promise<void> {
  const ready = sessionSyncPayloadSchema.parse(stored);
  const payloadHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJsonString(ready),
  );
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO sync_queue (
      id,entity_type,entity_id,operation,idempotency_key,payload_hash,payload,base_version,status,created_at,updated_at,local_revision
    ) VALUES (?,'workout_session',?,'upsert',?,?,?,?,'pending',?,?,?)`,
    Crypto.randomUUID(),
    ready.id,
    Crypto.randomUUID(),
    payloadHash,
    JSON.stringify(ready),
    serverVersion > 0 ? serverVersion : null,
    now,
    now,
    localRevision,
  );
}

async function applyRemoteSession(
  userId: string,
  payload: SessionSyncPayload,
  serverVersion: number,
  expectedRevision: number,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    if (!(await canApplyRemote(tx, 'workout_session', payload.id, expectedRevision, serverVersion)))
      return;
    await writeSession(tx, payload, serverVersion, false, expectedRevision, null);
  });
}

async function reconcileFeedbackVersions(database: Database, remote: SessionSyncPayload) {
  await localTransaction(database, async (tx) => {
    const update = (payload: SessionSyncPayload) => {
      for (const item of payload.feedback) {
        const stored = remote.feedback.find(
          (row) => row.id === item.id && row.exerciseSessionId === item.exerciseSessionId,
        );
        if (stored && item.version < stored.version) item.version = stored.version;
      }
      return payload;
    };
    const row = await tx.getFirstAsync<SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
      remote.id,
    );
    if (!row || row.conflict_operation_id) return;
    await tx.runAsync(
      'UPDATE sessions SET payload = ? WHERE id = ?',
      JSON.stringify(update(sessionSyncPayloadSchema.parse(JSON.parse(row.payload)))),
      remote.id,
    );
    const queued = await tx.getAllAsync<{ id: string; payload: string }>(
      "SELECT id,payload FROM sync_queue WHERE entity_type = 'workout_session' AND entity_id = ? AND status = 'pending' AND attempt_count = 0",
      remote.id,
    );
    for (const operation of queued) {
      const payload = update(sessionSyncPayloadSchema.parse(JSON.parse(operation.payload)));
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        canonicalJsonString(payload),
      );
      await tx.runAsync(
        'UPDATE sync_queue SET payload = ?, payload_hash = ? WHERE id = ?',
        JSON.stringify(payload),
        hash,
        operation.id,
      );
    }
  });
}

async function readyPayload(
  userId: string,
  payload: SessionSyncPayload,
  connection?: Database,
): Promise<SessionSyncPayload | null> {
  if (payload.planVersion >= 1 && payload.planSnapshot.version === payload.planVersion)
    return payload;
  const database = connection ?? (await openLocalDatabase(userId));
  const origin = await database.getFirstAsync<{
    server_version: number | null;
    official_snapshot: string | null;
  }>(
    `SELECT r.server_version,r.official_snapshot FROM sessions s JOIN local_plan_revisions r ON r.id=s.source_plan_revision_id WHERE s.id=?`,
    payload.id,
  );
  let official: SessionSyncPayload['planSnapshot'] | null = null;
  if (origin?.server_version && origin.official_snapshot)
    official = sessionPlanSnapshotSchema.parse(JSON.parse(origin.official_snapshot));
  if (!origin) {
    const row = await database.getFirstAsync<{ payload: string; version: number; pending: number }>(
      'SELECT payload,version,pending FROM plans WHERE id=?',
      payload.planId,
    );
    if (row && row.version > 0 && !row.pending) {
      const parsed = sessionPlanSnapshotSchema.safeParse(JSON.parse(row.payload));
      if (parsed.success) official = parsed.data;
    }
  }
  if (!official || canonicalPlanContent(payload.planSnapshot) !== canonicalPlanContent(official))
    return null;
  return sessionSyncPayloadSchema.parse({
    ...payload,
    planVersion: official.version,
    planSnapshot: official,
  });
}

/** Old clients changed only planVersion, leaving snapshot.version=0. Verify the CLAIMED revision, never guess latest. */
async function repairLegacyBindings(database: Database) {
  const rows = await database.getAllAsync<SessionRow>(
    'SELECT * FROM sessions WHERE pending=1 AND conflict_operation_id IS NULL',
  );
  for (const row of rows) {
    const payload = sessionSyncPayloadSchema.parse(JSON.parse(row.payload));
    if (payload.planVersion < 1 || payload.planVersion === payload.planSnapshot.version) continue;
    const official = await getPlanRevisionRequest(payload.planId, payload.planVersion).catch(
      () => null,
    );
    if (
      !official ||
      official.version !== payload.planVersion ||
      official.snapshot.version !== payload.planVersion ||
      canonicalPlanContent(official.snapshot) !== canonicalPlanContent(payload.planSnapshot)
    ) {
      await localTransaction(database, async (tx) => {
        await tx.runAsync(
          'UPDATE sessions SET dependency_error=? WHERE id=? AND local_revision=?',
          'A revisão histórica precisa ser conferida antes do envio. O treino continua preservado.',
          row.id,
          row.local_revision,
        );
      });
      continue;
    }
    await localTransaction(database, async (tx) => {
      const latest = await tx.getFirstAsync<SessionRow>(
        'SELECT * FROM sessions WHERE id=?',
        row.id,
      );
      if (!latest || latest.local_revision !== row.local_revision || latest.conflict_operation_id)
        return;
      const repaired = sessionSyncPayloadSchema.parse({
        ...payload,
        planSnapshot: official.snapshot,
      });
      await tx.runAsync(
        "UPDATE sync_queue SET status='superseded',updated_at=? WHERE entity_type='workout_session' AND entity_id=? AND status IN ('pending','error')",
        new Date().toISOString(),
        row.id,
      );
      await writeSession(tx, repaired, latest.server_version, true, latest.local_revision, null);
      await tx.runAsync('UPDATE sessions SET dependency_error=NULL WHERE id=?', row.id);
      await enqueueSession(tx, repaired, latest.server_version, latest.local_revision);
    });
  }
}

async function adoptSyncedPlans(userId: string, database: Database): Promise<void> {
  await localTransaction(database, async (tx) => {
    const rows = await tx.getAllAsync<SessionRow>(`SELECT * FROM sessions WHERE pending = 1`);
    for (const row of rows) {
      if (row.conflict_operation_id) continue;
      const session = mapSession(row);
      const ready = await readyPayload(userId, session, tx);
      if (!ready) continue; // Explicit dirty state retained until its plan dependency can be sent.
      const queued = await tx.getFirstAsync(
        `SELECT id FROM sync_queue WHERE entity_type = 'workout_session' AND entity_id = ? AND local_revision = ? AND status IN ('pending','in_flight','error')`,
        row.id,
        row.local_revision,
      );
      if (!queued) {
        await tx.runAsync(
          `UPDATE sessions SET payload = ? WHERE id = ?`,
          JSON.stringify(ready),
          row.id,
        );
        await tx.runAsync('UPDATE sessions SET dependency_error=NULL WHERE id=?', row.id);
        await enqueueSession(tx, ready, row.server_version, row.local_revision);
      }
    }
  });
}

async function discardLocal(database: Database, sessionId: string): Promise<void> {
  await database.runAsync(`DELETE FROM sessions WHERE id = ?`, sessionId);
  await database.runAsync(
    `DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'workout_session' AND status IN ('pending','error')`,
    sessionId,
  );
}

function mapSession(row: SessionRow): LocalSession {
  const payload = sessionSyncPayloadSchema.parse(JSON.parse(row.payload) as unknown);
  return {
    ...payload,
    serverVersion: row.server_version,
    dependencyError: row.dependency_error ?? null,
    pending: row.pending === 1,
    synced: row.synced === 1,
    conflictOperationId: row.conflict_operation_id,
  };
}
