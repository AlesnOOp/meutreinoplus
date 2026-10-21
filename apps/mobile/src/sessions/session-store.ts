import {
  canonicalJsonString,
  effectiveSet,
  sessionPlanSnapshotSchema,
  sessionSyncPayloadSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
import * as Crypto from 'expo-crypto';
import { ApiClientError, isNetworkError } from '@/api/errors';
import {
  getSessionRequest,
  openSessionRequest,
  pushSessionSync,
  resolveSessionConflictRequest,
  startSessionRequest,
} from '@/api/sessions';
import { openLocalDatabase } from '@/db/local-database';
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
};

type QueueRow = {
  id: string;
  entity_id: string;
  idempotency_key: string;
  payload_hash: string;
  payload: string;
  base_version: number | null;
  created_at: string;
};

export type LocalSession = SessionSyncPayload & {
  serverVersion: number;
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
  const snapshot = sessionPlanSnapshotSchema.parse({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    accent: plan.accent,
    status: plan.status,
    version: plan.version,
    duplicatedFromId: null,
    createdAt: plan.updatedAt,
    updatedAt: plan.updatedAt,
    archivedAt: null,
    exercises: plan.exercises,
  });
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
    planVersion: Math.max(plan.version, 0),
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
  await persist(userId, local, 0, true);
  if (!online || !synced.synced || synced.conflicts > 0) {
    return (await readLocalSession(userId, sessionId))!;
  }
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
    await persist(userId, remote.payload, remote.version, false);
    return (await readLocalSession(userId, remote.payload.id))!;
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'session_open') {
      const remote = await openSessionRequest();
      if (remote.session) {
        await persist(userId, remote.session.payload, remote.session.version, false);
        await discardLocal(userId, sessionId);
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

export async function syncSessions(
  userId: string,
): Promise<{ synced: boolean; conflicts: number }> {
  const plans = await syncPlans(userId).catch((error: unknown) => {
    if (isNetworkError(error)) {
      return { synced: false, conflicts: 0 };
    }
    throw error;
  });
  const database = await openLocalDatabase(userId);
  await adoptSyncedPlans(userId, database);
  const queued = await database.getAllAsync<QueueRow>(
    `SELECT id, entity_id, idempotency_key, payload_hash, payload, base_version, created_at
     FROM sync_queue WHERE status = 'pending' AND entity_type = 'workout_session' ORDER BY created_at ASC LIMIT 20`,
  );
  let conflicts = plans.conflicts;
  if (queued.length > 0) {
    const ids = queued.map((row) => row.id);
    await database.runAsync(
      `UPDATE sync_queue SET status = 'in_flight', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      new Date().toISOString(),
      ...ids,
    );
    try {
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
        if (!row) {
          continue;
        }
        if (item.code === 'session_open' || item.code === 'plan_not_synced') {
          await database.runAsync(
            `UPDATE sync_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
            item.code,
            new Date().toISOString(),
            item.id,
          );
          continue;
        }
        if (item.status === 'applied') {
          await database.runAsync(
            `UPDATE sync_queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`,
            new Date().toISOString(),
            item.id,
          );
          const openQueue = await database.getFirstAsync<{ id: string }>(
            `SELECT id FROM sync_queue WHERE entity_id = ? AND status IN ('pending', 'in_flight', 'error')`,
            row.entity_id,
          );
          if (!openQueue) {
            const remote = await getSessionRequest(row.entity_id).catch(() => null);
            if (remote) {
              await persist(userId, remote.payload, remote.version, false);
            }
          }
        } else {
          conflicts += item.status === 'conflict' ? 1 : 0;
          await database.runAsync(
            `UPDATE sync_queue SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
            item.code ?? item.status,
            new Date().toISOString(),
            item.id,
          );
          if (item.status === 'conflict') {
            await database.runAsync(
              `UPDATE sessions SET conflict_operation_id = ?, pending = 1 WHERE id = ?`,
              item.id,
              row.entity_id,
            );
          }
        }
      }
    } catch (error) {
      await database.runAsync(
        `UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE status = 'in_flight' AND entity_type = 'workout_session'`,
        new Date().toISOString(),
      );
      if (isNetworkError(error)) {
        return { synced: false, conflicts };
      }
      throw error;
    }
  }
  try {
    const remote = await openSessionRequest();
    if (remote.session) {
      const local = await readLocalSession(userId, remote.session.payload.id);
      if (!local || (!local.pending && !local.conflictOperationId)) {
        await persist(userId, remote.session.payload, remote.session.version, false);
      }
    }
  } catch (error) {
    if (isNetworkError(error)) {
      return { synced: false, conflicts };
    }
  }
  return { synced: true, conflicts };
}

export async function resolveLocalSessionConflict(
  userId: string,
  sessionId: string,
  choice: 'keep_server' | 'keep_local' | 'keep_both',
): Promise<void> {
  const current = await readLocalSession(userId, sessionId);
  if (!current?.conflictOperationId) {
    return;
  }
  const remote = await resolveSessionConflictRequest(current.conflictOperationId, choice);
  // The server has already reconciled the choice and created immutable corrections.
  await persist(userId, remote.payload, remote.version, false);
  const database = await openLocalDatabase(userId);
  await database.runAsync(
    `UPDATE sync_queue SET status = 'done', updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    current.conflictOperationId,
  );
  await database.runAsync(
    `UPDATE sessions SET conflict_operation_id = NULL WHERE id = ?`,
    sessionId,
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
  const current = await readLocalSession(userId, sessionId);
  if (!current) {
    throw new Error('Treino não encontrado.');
  }
  if (current.status === 'completed' || current.status === 'aborted') {
    throw new Error('Este treino já foi encerrado.');
  }
  change(current);
  const parsed = sessionSyncPayloadSchema.parse(current);
  await persist(userId, parsed, current.serverVersion, current.conflictOperationId == null);
  return (await readLocalSession(userId, sessionId))!;
}

async function persist(
  userId: string,
  payload: SessionSyncPayload,
  serverVersion: number,
  queue: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const stored = sessionSyncPayloadSchema.parse(payload);
  const now = new Date().toISOString();
  const existing = await database.getFirstAsync<SessionRow>(
    `SELECT * FROM sessions WHERE id = ?`,
    stored.id,
  );
  const ready =
    queue && !existing?.conflict_operation_id ? await readyPayload(userId, stored) : null;
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO sessions (
        id, status, plan_id, plan_name, server_version, payload, updated_at, pending, synced, conflict_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        plan_name = excluded.plan_name,
        server_version = excluded.server_version,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        pending = excluded.pending,
        synced = excluded.synced`,
      stored.id,
      stored.status,
      stored.planId,
      stored.planName,
      serverVersion,
      JSON.stringify(stored),
      now,
      queue ? 1 : 0,
      queue ? (existing?.synced ?? 0) : 1,
      existing?.conflict_operation_id ?? null,
    );
    if (!queue) {
      await database.runAsync(
        `DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'workout_session' AND status IN ('pending', 'error')`,
        stored.id,
      );
      return;
    }
    if (!ready) {
      return;
    }
    const payloadHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      canonicalJsonString(ready),
    );
    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'workout_session' AND status IN ('pending', 'error')`,
      stored.id,
    );
    await database.runAsync(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, idempotency_key, payload_hash, payload, base_version, status, created_at, updated_at
      ) VALUES (?, 'workout_session', ?, 'upsert', ?, ?, ?, ?, 'pending', ?, ?)`,
      Crypto.randomUUID(),
      stored.id,
      Crypto.randomUUID(),
      payloadHash,
      JSON.stringify(ready),
      serverVersion > 0 ? serverVersion : null,
      now,
      now,
    );
  });
}

async function readyPayload(
  userId: string,
  payload: SessionSyncPayload,
): Promise<SessionSyncPayload | null> {
  if (payload.planVersion >= 1) {
    return payload;
  }
  const plan = await readLocalPlan(userId, payload.planId);
  if (!plan || plan.version < 1 || !plan.synced) {
    return null;
  }
  const same = payload.planSnapshot.exercises.every((exercise) => {
    const current = plan.exercises.find((item) => item.id === exercise.id);
    if (!current) {
      return false;
    }
    return exercise.sets.every((set) =>
      current.sets.some(
        (item) =>
          item.id === set.id && item.load === set.load && item.repetitions === set.repetitions,
      ),
    );
  });
  if (!same || payload.planSnapshot.exercises.length !== plan.exercises.length) {
    return null;
  }
  return sessionSyncPayloadSchema.parse({ ...payload, planVersion: plan.version });
}

async function adoptSyncedPlans(userId: string, database: Database): Promise<void> {
  const rows = await database.getAllAsync<SessionRow>(`SELECT * FROM sessions WHERE pending = 1`);
  for (const row of rows) {
    const session = mapSession(row);
    if (session.planVersion >= 1 || session.conflictOperationId) {
      continue;
    }
    const ready = await readyPayload(userId, session);
    if (ready) {
      await persist(userId, ready, session.serverVersion, true);
    }
  }
}

async function discardLocal(userId: string, sessionId: string): Promise<void> {
  const database = await openLocalDatabase(userId);
  await database.runAsync(`DELETE FROM sessions WHERE id = ?`, sessionId);
  await database.runAsync(
    `DELETE FROM sync_queue WHERE entity_id = ? AND entity_type = 'workout_session' AND status IN ('pending', 'error')`,
    sessionId,
  );
}

function mapSession(row: SessionRow): LocalSession {
  const payload = sessionSyncPayloadSchema.parse(JSON.parse(row.payload) as unknown);
  return {
    ...payload,
    serverVersion: row.server_version,
    pending: row.pending === 1,
    synced: row.synced === 1,
    conflictOperationId: row.conflict_operation_id,
  };
}
