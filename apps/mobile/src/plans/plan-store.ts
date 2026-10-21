import {
  canonicalJsonString,
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
import { retainedLocalIds } from '@/catalog/merge';
import { openLocalDatabase } from '@/db/local-database';

type Database = Awaited<ReturnType<typeof openLocalDatabase>>;

type PlanRow = {
  id: string;
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

type QueueRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: 'upsert';
  idempotency_key: string;
  payload_hash: string;
  payload: string;
  base_version: number | null;
  created_at: string;
};

export type LocalPlan = PlanSyncPayload & {
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
  return row ? mapPlan(row) : null;
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
  const current = await readLocalPlan(userId, planId);
  if (!current) {
    throw new Error('Ficha não encontrada.');
  }
  change(current);
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<PlanRow>(`SELECT * FROM plans WHERE id = ?`, planId);
  await commit(userId, current, row?.synced === 1 ? row.version : null);
  return (await readLocalPlan(userId, planId)) ?? current;
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

export async function syncPlans(userId: string): Promise<{ synced: boolean; conflicts: number }> {
  const catalog = await syncCatalog(userId);
  const database = await openLocalDatabase(userId);
  const queued = await database.getAllAsync<QueueRow>(
    `SELECT * FROM sync_queue WHERE status = 'pending' AND entity_type = 'workout_plan' ORDER BY created_at ASC LIMIT 20`,
  );
  let conflicts = catalog.conflicts;
  if (queued.length > 0) {
    const ids = queued.map((row) => row.id);
    await database.runAsync(
      `UPDATE sync_queue SET status = 'in_flight', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      new Date().toISOString(),
      ...ids,
    );
    try {
      const result = await pushCatalogSync(
        queued.map((row) => ({
          id: row.id,
          entityType: row.entity_type,
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
        if (!row) {
          continue;
        }
        if (item.status === 'applied') {
          await database.runAsync(
            `UPDATE sync_queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`,
            new Date().toISOString(),
            item.id,
          );
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
              `UPDATE plans SET conflict_operation_id = ?, pending = 1 WHERE id = ?`,
              item.id,
              row.entity_id,
            );
          }
        }
      }
    } catch (error) {
      await database.runAsync(
        `UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE status = 'in_flight' AND entity_type = 'workout_plan'`,
        new Date().toISOString(),
      );
      if (isNetworkError(error)) {
        return { synced: false, conflicts };
      }
      throw error;
    }
  }
  try {
    await refreshPlans(database);
  } catch (error) {
    if (isNetworkError(error)) {
      return { synced: false, conflicts };
    }
    throw error;
  }
  return { synced: true, conflicts };
}

export async function resolveLocalConflict(
  userId: string,
  planId: string,
  choice: 'keep_server' | 'keep_local' | 'keep_both',
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<PlanRow>(`SELECT * FROM plans WHERE id = ?`, planId);
  if (!row?.conflict_operation_id) {
    return;
  }
  const local = mapPlan(row);
  const result = await resolvePlanConflictRequest(
    row.conflict_operation_id,
    choice,
    choice === 'keep_server' ? undefined : local,
  );
  await writeServerPlan(database, result.plan);
  if (result.preservedPlan) {
    await writeServerPlan(database, result.preservedPlan);
  }
  await database.runAsync(
    `UPDATE sync_queue SET status = 'done', updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    row.conflict_operation_id,
  );
}

async function commit(userId: string, plan: LocalPlan, baseVersion: number | null): Promise<void> {
  const database = await openLocalDatabase(userId);
  const payload = JSON.parse(JSON.stringify(planSyncPayloadSchema.parse(plan))) as PlanSyncPayload;
  const now = new Date().toISOString();
  const existing = await database.getFirstAsync<PlanRow>(
    `SELECT * FROM plans WHERE id = ?`,
    plan.id,
  );
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO plans (
        id, name, description, accent, status, version, payload, updated_at, pending, synced, conflict_operation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        accent = excluded.accent,
        status = excluded.status,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        pending = 1`,
      payload.id,
      payload.name,
      payload.description,
      payload.accent ?? null,
      payload.status,
      existing?.version ?? 0,
      JSON.stringify(payload),
      now,
      existing?.synced ?? 0,
      existing?.conflict_operation_id ?? null,
    );
    if (existing?.conflict_operation_id) {
      return;
    }
    const payloadHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      canonicalJsonString(payload),
    );
    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_id = ? AND status = 'pending'`,
      payload.id,
    );
    await database.runAsync(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, idempotency_key, payload_hash, payload, base_version, status, created_at, updated_at
      ) VALUES (?, 'workout_plan', ?, 'upsert', ?, ?, ?, ?, 'pending', ?, ?)`,
      Crypto.randomUUID(),
      payload.id,
      Crypto.randomUUID(),
      payloadHash,
      JSON.stringify(payload),
      baseVersion,
      now,
      now,
    );
  });
}

async function refreshPlans(database: Database): Promise<void> {
  const remote: PlanView[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await listPlansRequest(page, true);
    remote.push(...result.items);
    if (remote.length >= result.total || result.items.length === 0) {
      break;
    }
  }
  const local = await database.getAllAsync<{ id: string; pending: number }>(
    `SELECT id, pending FROM plans`,
  );
  const keep = new Set(
    retainedLocalIds(
      local.map((row) => ({ id: row.id, pending: row.pending === 1 })),
      remote.map((plan) => plan.id),
    ),
  );
  for (const row of local) {
    if (!keep.has(row.id)) {
      await database.runAsync(`DELETE FROM plans WHERE id = ?`, row.id);
    }
  }
  for (const plan of remote) {
    const openQueue = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM sync_queue WHERE entity_id = ? AND status IN ('pending', 'in_flight', 'error')`,
      plan.id,
    );
    if (!openQueue) {
      await writeServerPlan(database, plan);
    }
  }
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
      conflict_operation_id = NULL`,
    payload.id,
    payload.name,
    payload.description,
    payload.accent ?? null,
    payload.status,
    plan.version,
    JSON.stringify(payload),
    plan.updatedAt,
  );
}

function mapPlan(row: PlanRow): LocalPlan {
  const payload = planSyncPayloadSchema.parse(JSON.parse(row.payload));
  return {
    ...payload,
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
