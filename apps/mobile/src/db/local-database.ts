import {
  localDatabaseName,
  queueStatusAfterRestart,
  type DeviceQueueStatus,
} from '@meutreino/shared';
import * as SQLite from 'expo-sqlite';

const SCHEMA_VERSION = '9';

export type LocalDatabaseStatus = {
  ready: true;
  databaseName: string;
  schemaVersion: number;
  pendingSyncCount: number;
  errorCount: number;
};

type CountRow = {
  pending: number | null;
  errors: number | null;
};

let openUserId: string | null = null;
let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openLocalDatabase(userId: string): Promise<SQLite.SQLiteDatabase> {
  if (openUserId !== userId) {
    databasePromise = initialize(userId);
    openUserId = userId;
  }
  return databasePromise!;
}

async function initialize(userId: string): Promise<SQLite.SQLiteDatabase> {
  const database = await SQLite.openDatabaseAsync(localDatabaseName(userId));
  await database.execAsync('PRAGMA journal_mode = WAL;');
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS local_plan_reconciliations (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, conflict_id TEXT NOT NULL,
      request TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS local_plan_reconciliation_pending ON local_plan_reconciliations(plan_id) WHERE result IS NULL;
    CREATE TABLE IF NOT EXISTS local_plan_derivations (
      origin_id TEXT PRIMARY KEY NOT NULL, source_origin_id TEXT NOT NULL,
      decision_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS local_plan_derivation_immutable BEFORE UPDATE ON local_plan_derivations
      BEGIN SELECT RAISE(ABORT,'derivation is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_plan_derivation_no_delete BEFORE DELETE ON local_plan_derivations
      BEGIN SELECT RAISE(ABORT,'derivation is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_plan_reconciliation_request_immutable BEFORE UPDATE OF id,plan_id,conflict_id,request,created_at ON local_plan_reconciliations
      BEGIN SELECT RAISE(ABORT,'decision is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_plan_reconciliation_result_immutable BEFORE UPDATE OF result ON local_plan_reconciliations WHEN OLD.result IS NOT NULL
      BEGIN SELECT RAISE(ABORT,'receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_plan_reconciliation_no_delete BEFORE DELETE ON local_plan_reconciliations
      BEGIN SELECT RAISE(ABORT,'decision is immutable'); END;
    CREATE TABLE IF NOT EXISTS plan_conflict_intents (
      plan_id TEXT PRIMARY KEY NOT NULL, conflict_id TEXT NOT NULL,
      choice TEXT NOT NULL CHECK(choice IN ('keep_server','keep_local','keep_both')),
      payload TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_plan_revisions (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, local_revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL, parent_id TEXT, base_version INTEGER,
      server_version INTEGER, official_snapshot TEXT, created_at TEXT NOT NULL,
      UNIQUE(plan_id,local_revision),
      CHECK(server_version IS NULL OR server_version>0),
      CHECK((server_version IS NULL) = (official_snapshot IS NULL))
    );
    CREATE TRIGGER IF NOT EXISTS local_plan_revision_immutable BEFORE UPDATE OF id,plan_id,local_revision,snapshot,parent_id,base_version ON local_plan_revisions
      BEGIN SELECT RAISE(ABORT,'local plan revision is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS local_plan_revision_no_delete BEFORE DELETE ON local_plan_revisions
      BEGIN SELECT RAISE(ABORT,'local plan revision is immutable'); END;
    CREATE TABLE IF NOT EXISTS session_resolution_intents (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      conflict_id TEXT NOT NULL,
      local_revision INTEGER NOT NULL,
      request TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS session_resolution_pending ON session_resolution_intents(session_id) WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS session_variants (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '',
      base_version INTEGER,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gyms (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      nickname TEXT,
      branch_name TEXT,
      city TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      is_preferred INTEGER NOT NULL,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY NOT NULL,
      gym_id TEXT NOT NULL,
      name TEXT NOT NULL,
      machine_number TEXT,
      nickname TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      has_photo INTEGER NOT NULL DEFAULT 0,
      photo_base64 TEXT,
      photo_content_type TEXT,
      photo_pending INTEGER NOT NULL DEFAULT 0,
      exercise_ids TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY NOT NULL,
      origin TEXT NOT NULL,
      name_pt TEXT NOT NULL,
      alternative_name TEXT,
      activity_type TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      primary_muscle TEXT,
      secondary_muscles TEXT NOT NULL,
      equipment_types TEXT NOT NULL,
      status TEXT NOT NULL,
      editable INTEGER NOT NULL,
      version INTEGER NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      accent TEXT,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pending INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0,
      conflict_operation_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      server_version INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      pending INTEGER NOT NULL DEFAULT 1,
      synced INTEGER NOT NULL DEFAULT 0,
      conflict_operation_id TEXT
    );
  `);
  await migrateSchema(database);
  await recoverInterruptedAttempts(database);
  return database;
}

async function migrateSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.withTransactionAsync(() => migrateSchemaInTransaction(database));
}

async function migrateSchemaInTransaction(database: SQLite.SQLiteDatabase): Promise<void> {
  const version = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM local_meta WHERE key = 'schema_version'`,
  );
  if (version?.value === '1') {
    await ensureColumn(
      database,
      'sync_queue',
      'payload',
      `ALTER TABLE sync_queue ADD COLUMN payload TEXT NOT NULL DEFAULT ''`,
    );
  }
  await ensureColumn(
    database,
    'equipment',
    'photo_pending',
    `ALTER TABLE equipment ADD COLUMN photo_pending INTEGER NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    database,
    'gyms',
    'synced',
    `ALTER TABLE gyms ADD COLUMN synced INTEGER NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    database,
    'equipment',
    'synced',
    `ALTER TABLE equipment ADD COLUMN synced INTEGER NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    database,
    'exercises',
    'synced',
    `ALTER TABLE exercises ADD COLUMN synced INTEGER NOT NULL DEFAULT 0`,
  );
  // Recovery 02: revisions are logical counters, independent of wall-clock time.
  for (const table of ['gyms', 'equipment', 'exercises', 'sessions', 'plans']) {
    await ensureColumn(
      database,
      table,
      'local_revision',
      `ALTER TABLE ${table} ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0`,
    );
    await ensureColumn(
      database,
      table,
      'acknowledged_revision',
      `ALTER TABLE ${table} ADD COLUMN acknowledged_revision INTEGER NOT NULL DEFAULT 0`,
    );
    await ensureColumn(
      database,
      table,
      'stale_remote_version',
      `ALTER TABLE ${table} ADD COLUMN stale_remote_version INTEGER`,
    );
    if (table === 'plans' && Number(version?.value ?? '0') < 7)
      await database.runAsync(
        'UPDATE plans SET local_revision=1,synced=0 WHERE pending=1 AND local_revision=0',
      );
    if (Number(version?.value ?? '0') < 5 && table !== 'plans') {
      // Legacy queue entries remain revision 0. Dirty local rows get a newer revision;
      // the sync pass durably enqueues their latest payload before sending old entries.
      await database.runAsync(
        `UPDATE ${table} SET local_revision = 1 WHERE pending = 1 AND local_revision = 0`,
      );
      if (table !== 'sessions')
        await database.runAsync(`UPDATE ${table} SET version = 0 WHERE synced = 0`);
      await database.runAsync(`UPDATE ${table} SET synced = 0 WHERE pending = 1`);
    }
  }
  await ensureColumn(
    database,
    'plans',
    'origin_revision_id',
    'ALTER TABLE plans ADD COLUMN origin_revision_id TEXT',
  );
  await ensureColumn(
    database,
    'sessions',
    'source_plan_revision_id',
    'ALTER TABLE sessions ADD COLUMN source_plan_revision_id TEXT',
  );
  await ensureColumn(
    database,
    'sessions',
    'dependency_error',
    'ALTER TABLE sessions ADD COLUMN dependency_error TEXT',
  );
  await ensureColumn(
    database,
    'sync_queue',
    'local_revision',
    `ALTER TABLE sync_queue ADD COLUMN local_revision INTEGER NOT NULL DEFAULT 0`,
  );
  await database.runAsync(
    `INSERT INTO local_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    SCHEMA_VERSION,
  );
}

async function ensureColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  statement: string,
): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.length > 0 && !columns.some((item) => item.name === column)) {
    await database.execAsync(statement);
  }
}

async function recoverInterruptedAttempts(database: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await database.getAllAsync<{ id: string; status: DeviceQueueStatus }>(
    `SELECT id, status FROM sync_queue WHERE status = 'in_flight'`,
  );

  for (const row of rows) {
    const nextStatus = queueStatusAfterRestart(row.status);
    if (nextStatus === row.status) {
      continue;
    }
    await database.runAsync(`UPDATE sync_queue SET status = ?, updated_at = ? WHERE id = ?`, [
      nextStatus,
      new Date().toISOString(),
      row.id,
    ]);
  }
}

export async function readLocalDatabaseStatus(userId: string): Promise<LocalDatabaseStatus> {
  const database = await openLocalDatabase(userId);
  const version = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM local_meta WHERE key = 'schema_version'`,
  );
  const counts = await database.getFirstAsync<CountRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending', 'in_flight') THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors
     FROM sync_queue`,
  );

  return {
    ready: true,
    databaseName: localDatabaseName(userId),
    schemaVersion: Number(version?.value ?? '0'),
    pendingSyncCount: counts?.pending ?? 0,
    errorCount: counts?.errors ?? 0,
  };
}

export async function deleteLocalDatabase(userId: string): Promise<void> {
  if (openUserId === userId && databasePromise) {
    const database = await databasePromise;
    await database.closeAsync();
  }
  if (openUserId === userId) {
    openUserId = null;
    databasePromise = null;
  }
  await SQLite.deleteDatabaseAsync(localDatabaseName(userId));
}
