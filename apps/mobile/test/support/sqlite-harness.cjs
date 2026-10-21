const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const shared = require('@meutreino/shared');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// SQLite is real and file-backed. Only the Expo bridge API is adapted for the Node host.
function adapter(filename, controls = {}) {
  const sql = new DatabaseSync(filename);
  const params = (args) => (Array.isArray(args[0]) ? args[0] : args);
  return {
    filename,
    execAsync: async (statement) => {
      sql.exec(statement);
    },
    runAsync: async (statement, ...args) => {
      if (controls.fail?.test(statement)) {
        controls.fail = null;
        throw new Error('Injected SQLite write failure');
      }
      return sql.prepare(statement).run(...params(args));
    },
    getFirstAsync: async (statement, ...args) =>
      sql.prepare(statement).get(...params(args)) ?? null,
    getAllAsync: async (statement, ...args) => sql.prepare(statement).all(...params(args)),
    closeAsync: async () => sql.close(),
    async withTransactionAsync(task) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        await task();
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
    async withExclusiveTransactionAsync(task) {
      // A distinct connection, as used by expo-sqlite's native exclusive transaction.
      const tx = adapter(filename, controls);
      try {
        await tx.withTransactionAsync(() => task(tx));
      } finally {
        await tx.closeAsync();
      }
    },
  };
}

async function harness(
  directory = mkdtempSync(path.join(os.tmpdir(), 'meutreino-recovery02-')),
  legacy = false,
) {
  const user = crypto.randomUUID();
  const now = new Date().toISOString();
  const gym = {
    id: crypto.randomUUID(),
    name: 'A',
    nickname: null,
    branchName: null,
    city: null,
    notes: null,
    status: 'active',
    isPreferred: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const exercise = {
    id: crypto.randomUUID(),
    origin: 'user',
    namePt: 'Exercício A',
    alternativeName: null,
    activityType: 'strength',
    description: null,
    instructions: null,
    primaryMuscle: 'other',
    secondaryMuscles: [],
    equipmentTypes: [],
    status: 'active',
    editable: true,
    version: 1,
  };
  const equipment = {
    id: crypto.randomUUID(),
    gymId: gym.id,
    name: 'Máquina A',
    machineNumber: null,
    nickname: null,
    notes: null,
    status: 'active',
    hasPhoto: false,
    exerciseIds: [exercise.id],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const plan = {
    id: crypto.randomUUID(),
    name: 'Ficha',
    description: null,
    accent: null,
    status: 'active',
    version: 1,
    duplicatedFromId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    exercises: [
      {
        id: crypto.randomUUID(),
        exerciseId: exercise.id,
        exerciseName: exercise.namePt,
        orderIndex: 1,
        restSeconds: null,
        notes: null,
        equipment: [],
        sets: [],
      },
    ],
  };
  const remote = { gyms: [gym], equipment: [equipment], exercises: [exercise] };
  const sessions = new Map();
  const receipts = new Map();
  const copies = (v) => JSON.parse(JSON.stringify(v));
  const api = {
    pullCatalogSnapshot: async () => copies(remote),
    pushCatalogSync: async (operations) => ({
      results: operations.map((op) => {
        if (!receipts.has(op.idempotencyKey)) {
          const table =
            op.entityType === 'gym'
              ? 'gyms'
              : op.entityType === 'equipment'
                ? 'equipment'
                : 'exercises';
          const rows = remote[table];
          const previous = rows.find((row) => row.id === op.entityId);
          const next = {
            ...(previous ?? {}),
            ...copies(op.payload),
            version: (previous?.version ?? 0) + 1,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
          };
          if (table === 'exercises') {
            next.origin = 'user';
            next.editable = true;
          }
          if (previous) rows[rows.indexOf(previous)] = next;
          else rows.push(next);
          receipts.set(op.idempotencyKey, true);
        }
        return { id: op.id, status: 'applied' };
      }),
    }),
    listPlansRequest: async () => ({ items: [copies(plan)], total: 1 }),
    startSessionRequest: async (body) => ({ payload: sessions.get(body.id), version: 1 }),
    pushSessionSync: async (operations) => ({
      results: operations.map((op) => {
        if (!receipts.has(op.idempotencyKey)) {
          const old = sessions.get(op.entityId);
          sessions.set(op.entityId, {
            payload: copies(op.payload),
            version: (old?.version ?? 0) + 1,
          });
          receipts.set(op.idempotencyKey, true);
        }
        return { id: op.id, status: 'applied' };
      }),
    }),
    getSessionRequest: async (id) => copies(sessions.get(id)),
    openSessionRequest: async () => ({ session: null }),
  };
  const controls = {};
  function runtime() {
    const cache = new Map();
    function load(relative) {
      const filename = path.resolve(__dirname, '../../src', `${relative}.ts`);
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} };
      cache.set(filename, module);
      const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const requireModule = (name) => {
        if (name === '@meutreino/shared') return shared;
        if (name === 'expo-crypto')
          return {
            randomUUID: crypto.randomUUID,
            CryptoDigestAlgorithm: { SHA256: 'sha256' },
            digestStringAsync: async (_algo, value) =>
              crypto.createHash('sha256').update(value).digest('hex'),
          };
        if (name === 'react-native') return { Platform: { OS: 'ios' } };
        if (name === 'expo-sqlite')
          return {
            openDatabaseAsync: async (name) => {
              const db = adapter(path.join(directory, name), controls);
              return db;
            },
          };
        if (['@/api/catalog', '@/api/sessions', '@/api/plans'].includes(name)) return api;
        if (name.startsWith('@/')) return load(name.slice(2));
        if (name.startsWith('.')) {
          return load(
            path.relative(
              path.resolve(__dirname, '../../src'),
              path.resolve(path.dirname(filename), name),
            ),
          );
        }
        throw new Error(`Unexpected runtime dependency: ${name}`);
      };
      vm.runInNewContext(
        code,
        {
          module,
          exports: module.exports,
          require: requireModule,
          console,
          setTimeout,
          clearTimeout,
          Map,
          WeakMap,
          Promise,
          JSON,
        },
        { filename },
      );
      return module.exports;
    }
    return {
      load,
      catalog: load('catalog/catalog-store'),
      store: load('sessions/session-store'),
      database: load('db/local-database'),
      errors: load('api/errors'),
    };
  }
  if (legacy) {
    const old = adapter(path.join(directory, shared.localDatabaseName(user)), controls);
    await old.execAsync(`CREATE TABLE local_meta (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);
      INSERT INTO local_meta VALUES ('schema_version','4');
      CREATE TABLE gyms (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,nickname TEXT,branch_name TEXT,city TEXT,notes TEXT,status TEXT NOT NULL,is_preferred INTEGER NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,pending INTEGER NOT NULL DEFAULT 0,synced INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sync_queue (id TEXT PRIMARY KEY NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,base_version INTEGER,status TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    await old.runAsync(
      `INSERT INTO gyms VALUES (?, 'Legacy B', NULL,NULL,NULL,NULL,'active',0,1,?,1,1)`,
      gym.id,
      now,
    );
    const payload = shared.gymSyncPayloadSchema.parse({ ...gym, name: 'Legacy A' });
    await old.runAsync(
      `INSERT INTO sync_queue (id,entity_type,entity_id,operation,idempotency_key,payload_hash,payload,base_version,status,created_at,updated_at) VALUES (?,'gym',?,'upsert',?,?,?,1,'in_flight',?,?)`,
      crypto.randomUUID(),
      gym.id,
      crypto.randomUUID(),
      crypto.createHash('sha256').update(shared.canonicalJsonString(payload)).digest('hex'),
      JSON.stringify(payload),
      now,
      now,
    );
    await old.closeAsync();
  }
  let app = runtime();
  let db = await app.database.openLocalDatabase(user);
  await app.catalog.syncCatalog(user);
  await db.runAsync(
    `INSERT INTO plans (id,name,description,accent,status,version,payload,updated_at,pending,synced) VALUES (?,?,NULL,NULL,'active',1,?,?,0,1)`,
    plan.id,
    plan.name,
    JSON.stringify(plan),
    now,
  );
  return {
    user,
    gym,
    equipment,
    exercise,
    plan,
    remote,
    api,
    sessions,
    receipts,
    directory,
    get db() {
      return db;
    },
    get catalog() {
      return app.catalog;
    },
    get store() {
      return app.store;
    },
    get errors() {
      return app.errors;
    },
    get load() {
      return app.load;
    },
    failNextSql(pattern) {
      controls.fail = pattern;
    },
    async reopen() {
      await db.closeAsync();
      app = runtime();
      db = await app.database.openLocalDatabase(user);
    },
    async close() {
      await db.closeAsync();
    },
  };
}

module.exports = { harness, deferred };
