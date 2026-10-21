import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

export type SyncEntity = 'gym' | 'equipment' | 'exercise' | 'workout_session';
const tables = {
  gym: 'gyms',
  equipment: 'equipment',
  exercise: 'exercises',
  workout_session: 'sessions',
} as const;
export const syncTable = (type: SyncEntity) => tables[type];
const versionColumn = (type: SyncEntity) =>
  type === 'workout_session' ? 'server_version' : 'version';
export type Revision = { local_revision: number; acknowledged_revision: number; version: number };
export type QueuedRevision = {
  id: string;
  entity_id: string;
  entity_type: SyncEntity;
  operation: 'upsert';
  idempotency_key: string;
  payload_hash: string;
  payload: string;
  base_version: number | null;
  local_revision: number;
  created_at: string;
};

const writes = new WeakMap<SQLiteDatabase, Promise<void>>();
/** Short SQLite critical section only. The network must never run inside this callback. */
export async function localTransaction<T>(
  db: SQLiteDatabase,
  work: (tx: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  const previous = writes.get(db) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  writes.set(db, next);
  await previous;
  try {
    let result!: T;
    if (Platform.OS === 'web') {
      await db.withTransactionAsync(async () => {
        result = await work(db);
      });
    } else {
      await db.withExclusiveTransactionAsync(async (tx) => {
        result = await work(tx);
      });
    }
    return result;
  } finally {
    release();
    if (writes.get(db) === next) writes.delete(db);
  }
}

const syncing = new Map<string, Promise<unknown>>();
/** Coalesce transport per user/domain, while allowing all local edits to continue. */
export function singleSync<T>(userId: string, domain: string, work: () => Promise<T>): Promise<T> {
  const key = `${userId}:${domain}`;
  const running = syncing.get(key);
  if (running) return running as Promise<T>;
  const promise = work().finally(() => {
    if (syncing.get(key) === promise) syncing.delete(key);
  });
  syncing.set(key, promise);
  return promise;
}

export async function revision(
  db: SQLiteDatabase,
  type: SyncEntity,
  id: string,
): Promise<Revision | null> {
  return db.getFirstAsync<Revision>(
    `SELECT local_revision, acknowledged_revision, ${versionColumn(type)} AS version FROM ${syncTable(type)} WHERE id = ?`,
    id,
  );
}

export async function captureRevisions(
  db: SQLiteDatabase,
  type: SyncEntity,
): Promise<Map<string, Revision>> {
  const rows = await db.getAllAsync<Revision & { id: string }>(
    `SELECT id, local_revision, acknowledged_revision, ${versionColumn(type)} AS version FROM ${syncTable(type)}`,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

export async function hasPending(db: SQLiteDatabase, types: SyncEntity[]): Promise<boolean> {
  for (const type of types) {
    if (await db.getFirstAsync(`SELECT id FROM ${syncTable(type)} WHERE pending = 1 LIMIT 1`))
      return true;
  }
  return Boolean(
    await db.getFirstAsync(
      `SELECT id FROM sync_queue WHERE entity_type IN (${types.map(() => '?').join(',')}) AND status IN ('pending', 'in_flight', 'error') LIMIT 1`,
      ...types,
    ),
  );
}

/** Recheck within the write transaction, after the network response has arrived. */
export async function canApplyRemote(
  db: SQLiteDatabase,
  type: SyncEntity,
  id: string,
  expectedRevision: number,
  remoteVersion: number,
): Promise<boolean> {
  const current = await db.getFirstAsync<
    Revision & { pending: number; conflict_operation_id?: string | null }
  >(`SELECT *, ${versionColumn(type)} AS version FROM ${syncTable(type)} WHERE id = ?`, id);
  const queued = await db.getFirstAsync(
    `SELECT id FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND status IN ('pending', 'in_flight', 'error') LIMIT 1`,
    type,
    id,
  );
  if (
    (current?.local_revision ?? 0) !== expectedRevision ||
    current?.pending ||
    current?.conflict_operation_id ||
    queued ||
    (current?.version ?? 0) > remoteVersion
  ) {
    await db.runAsync(
      `UPDATE ${syncTable(type)} SET stale_remote_version = MAX(COALESCE(stale_remote_version, 0), ?) WHERE id = ?`,
      remoteVersion,
      id,
    );
    return false;
  }
  return true;
}

export async function claimOperations(
  db: SQLiteDatabase,
  types: SyncEntity[],
): Promise<QueuedRevision[]> {
  return localTransaction(db, async (tx) => {
    // One unresolved revision per entity at a time. Earlier attempts retain their idempotency key.
    const rows = await tx.getAllAsync<QueuedRevision>(
      `SELECT q.* FROM sync_queue q
      WHERE q.status = 'pending' AND q.entity_type IN (${types.map(() => '?').join(',')})
      AND NOT EXISTS (SELECT 1 FROM sync_queue older WHERE older.entity_type = q.entity_type
        AND older.entity_id = q.entity_id AND older.rowid < q.rowid AND older.status IN ('pending','in_flight','error'))
      ORDER BY q.rowid ASC LIMIT 20`,
      ...types,
    );
    for (const row of rows) {
      await tx.runAsync(
        `UPDATE sync_queue SET status = 'in_flight', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'pending'`,
        new Date().toISOString(),
        row.id,
      );
    }
    return rows;
  });
}

/** I1/I4: a receipt affects its queue row and acknowledged revision, never deletes another row. */
export async function acknowledge(db: SQLiteDatabase, sent: QueuedRevision): Promise<void> {
  await localTransaction(db, async (tx) => {
    const operation = await tx.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_queue WHERE id = ? AND idempotency_key = ? AND local_revision = ?`,
      sent.id,
      sent.idempotency_key,
      sent.local_revision,
    );
    if (!operation || operation.status === 'done') return;
    await tx.runAsync(
      `UPDATE sync_queue SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`,
      new Date().toISOString(),
      sent.id,
    );
    // Current server writers increment exactly once per applied operation (create => version 1).
    // A later snapshot must meet this lower bound before being allowed to replace local content.
    const serverVersion = (sent.base_version ?? 0) + 1;
    const version = versionColumn(sent.entity_type);
    await tx.runAsync(
      `UPDATE sync_queue SET base_version = CASE WHEN base_version IS NULL OR base_version < ? THEN ? ELSE base_version END
      WHERE entity_type = ? AND entity_id = ? AND local_revision > ? AND status = 'pending' AND attempt_count = 0`,
      serverVersion,
      serverVersion,
      sent.entity_type,
      sent.entity_id,
      sent.local_revision,
    );
    const pending = await tx.getFirstAsync(
      `SELECT id FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND status IN ('pending','in_flight','error') LIMIT 1`,
      sent.entity_type,
      sent.entity_id,
    );
    await tx.runAsync(
      `UPDATE ${syncTable(sent.entity_type)} SET
      ${version} = MAX(${version}, ?), acknowledged_revision = MAX(acknowledged_revision, ?),
      pending = CASE WHEN local_revision > ? OR ? THEN 1 ELSE 0 END,
      synced = CASE WHEN local_revision > ? OR ? THEN 0 ELSE 1 END WHERE id = ?`,
      serverVersion,
      sent.local_revision,
      sent.local_revision,
      pending ? 1 : 0,
      sent.local_revision,
      pending ? 1 : 0,
      sent.entity_id,
    );
  });
}

export async function releaseOperations(db: SQLiteDatabase, rows: QueuedRevision[]): Promise<void> {
  await localTransaction(db, async (tx) => {
    for (const row of rows) {
      await tx.runAsync(
        `UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'in_flight'`,
        new Date().toISOString(),
        row.id,
      );
    }
  });
}
