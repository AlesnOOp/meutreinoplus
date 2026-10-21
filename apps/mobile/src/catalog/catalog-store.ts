import {
  canonicalJsonString,
  equipmentSyncPayloadSchema,
  exerciseSyncPayloadSchema,
  gymSyncPayloadSchema,
  type EquipmentView,
  type EquipmentWrite,
  type ExerciseView,
  type ExerciseWrite,
  type GymView,
  type GymWrite,
  accountSchema,
  type AccountView,
} from '@meutreino/shared';
import * as Crypto from 'expo-crypto';
import {
  deleteEquipmentPhotoRequest,
  pullCatalogSnapshot,
  pushCatalogSync,
  uploadEquipmentPhotoRequest,
} from '@/api/catalog';
import { isNetworkError } from '@/api/errors';
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
  syncTable,
  type QueuedRevision,
} from '@/db/sync-state';

type Database = Awaited<ReturnType<typeof openLocalDatabase>>;

export type SyncReport = { synced: boolean; conflicts: number };

export async function countPendingOperations(userId: string): Promise<number> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<{ pending: number }>(
    `SELECT COUNT(*) AS pending FROM sync_queue WHERE status IN ('pending', 'error', 'in_flight')`,
  );
  return row?.pending ?? 0;
}

export async function cacheAccount(userId: string, account: AccountView): Promise<void> {
  const database = await openLocalDatabase(userId);
  await database.runAsync(
    `INSERT INTO local_meta (key, value) VALUES ('account_json', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    JSON.stringify(account),
  );
}

export async function readCachedAccount(userId: string): Promise<AccountView | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM local_meta WHERE key = 'account_json'`,
  );
  if (!row) {
    return null;
  }
  const parsed = accountSchema.safeParse(JSON.parse(row.value) as unknown);
  return parsed.success ? parsed.data : null;
}

export async function listLocalGyms(userId: string): Promise<GymView[]> {
  const database = await openLocalDatabase(userId);
  const rows = await database.getAllAsync<GymRow>(
    `SELECT * FROM gyms WHERE status = 'active' ORDER BY is_preferred DESC, name COLLATE NOCASE ASC`,
  );
  return rows.map(mapGym);
}

export async function readLocalGym(userId: string, gymId: string): Promise<GymView | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, gymId);
  return row ? mapGym(row) : null;
}

export async function saveGym(
  userId: string,
  input: GymWrite & { id?: string },
  online: boolean,
): Promise<GymView> {
  const database = await openLocalDatabase(userId);
  const id = await localTransaction(database, async (tx) => {
    const current = input.id
      ? await tx.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, input.id)
      : null;
    const view = gymFromWrite(current, input);
    if (view.isPreferred) {
      const others = await tx.getAllAsync<GymRow>(
        `SELECT * FROM gyms WHERE is_preferred = 1 AND id <> ?`,
        view.id,
      );
      for (const other of others)
        await saveCatalogRevision(tx, 'gym', { ...mapGym(other), isPreferred: false });
    }
    await saveCatalogRevision(tx, 'gym', view);
    return view.id;
  });
  if (online) await syncCatalog(userId);
  return (await readLocalGym(userId, id))!;
}

export async function archiveGym(userId: string, gymId: string, online: boolean): Promise<void> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    const current = await tx.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, gymId);
    if (current)
      await saveCatalogRevision(tx, 'gym', {
        ...mapGym(current),
        status: 'archived',
        isPreferred: false,
      });
  });
  if (online) await syncCatalog(userId);
}

export async function listLocalEquipment(userId: string, gymId?: string): Promise<EquipmentView[]> {
  const database = await openLocalDatabase(userId);
  const rows = gymId
    ? await database.getAllAsync<EquipmentRow>(
        `SELECT * FROM equipment WHERE gym_id = ? AND status = 'active' ORDER BY machine_number, name COLLATE NOCASE`,
        gymId,
      )
    : await database.getAllAsync<EquipmentRow>(
        `SELECT * FROM equipment WHERE status = 'active' ORDER BY name COLLATE NOCASE`,
      );
  return rows.map(mapEquipment);
}

export async function readLocalEquipment(
  userId: string,
  equipmentId: string,
): Promise<(EquipmentView & { photoUri: string | null }) | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<EquipmentRow>(
    `SELECT * FROM equipment WHERE id = ?`,
    equipmentId,
  );
  if (!row) {
    return null;
  }
  return { ...mapEquipment(row), photoUri: photoUri(row) };
}

export async function saveEquipment(
  userId: string,
  gymId: string,
  input: EquipmentWrite & { id?: string },
  online: boolean,
): Promise<EquipmentView> {
  const database = await openLocalDatabase(userId);
  const id = await localTransaction(database, async (tx) => {
    const current = input.id
      ? await tx.getFirstAsync<EquipmentRow>(
          `SELECT * FROM equipment WHERE id = ? AND gym_id = ?`,
          input.id,
          gymId,
        )
      : null;
    const view = equipmentFromWrite(current, gymId, input);
    await saveCatalogRevision(tx, 'equipment', view);
    return view.id;
  });
  if (online) await syncCatalog(userId);
  return (await readLocalEquipment(userId, id))!;
}

export async function archiveEquipment(
  userId: string,
  gymId: string,
  equipmentId: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    const current = await tx.getFirstAsync<EquipmentRow>(
      `SELECT * FROM equipment WHERE id = ? AND gym_id = ?`,
      equipmentId,
      gymId,
    );
    if (current)
      await saveCatalogRevision(tx, 'equipment', { ...mapEquipment(current), status: 'archived' });
  });
  if (online) await syncCatalog(userId);
}

export async function saveEquipmentPhoto(
  userId: string,
  gymId: string,
  equipmentId: string,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  dataBase64: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  if (online) {
    try {
      await uploadEquipmentPhotoRequest(gymId, equipmentId, contentType, dataBase64);
      await database.runAsync(
        `UPDATE equipment SET has_photo = 1, photo_base64 = ?, photo_content_type = ?, photo_pending = 0, updated_at = ? WHERE id = ?`,
        dataBase64,
        contentType,
        new Date().toISOString(),
        equipmentId,
      );
      return;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  await database.runAsync(
    `UPDATE equipment SET has_photo = 1, photo_base64 = ?, photo_content_type = ?, photo_pending = 1, updated_at = ? WHERE id = ?`,
    dataBase64,
    contentType,
    new Date().toISOString(),
    equipmentId,
  );
}

export async function cacheDownloadedPhoto(
  userId: string,
  equipmentId: string,
  dataUrl: string,
): Promise<void> {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) {
    return;
  }
  const database = await openLocalDatabase(userId);
  await database.runAsync(
    `UPDATE equipment SET has_photo = 1, photo_content_type = ?, photo_base64 = ?, photo_pending = 0 WHERE id = ?`,
    match[1],
    match[2],
    equipmentId,
  );
}

export async function removeEquipmentPhoto(
  userId: string,
  gymId: string,
  equipmentId: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const current = await database.getFirstAsync<EquipmentRow>(
    `SELECT * FROM equipment WHERE id = ?`,
    equipmentId,
  );
  if (!current) {
    return;
  }
  if (current.photo_pending === 1 || !current.has_photo) {
    await database.runAsync(
      `UPDATE equipment SET has_photo = 0, photo_base64 = NULL, photo_content_type = NULL, photo_pending = 0 WHERE id = ?`,
      equipmentId,
    );
    return;
  }
  if (online) {
    try {
      await deleteEquipmentPhotoRequest(gymId, equipmentId);
      await database.runAsync(
        `UPDATE equipment SET has_photo = 0, photo_base64 = NULL, photo_content_type = NULL, photo_pending = 0 WHERE id = ?`,
        equipmentId,
      );
      return;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  await database.runAsync(
    `UPDATE equipment SET has_photo = 0, photo_base64 = NULL, photo_content_type = NULL, photo_pending = 2 WHERE id = ?`,
    equipmentId,
  );
}

export async function listLocalExercises(
  userId: string,
  query: { q?: string; origin?: 'user' | 'system' },
): Promise<ExerciseView[]> {
  const database = await openLocalDatabase(userId);
  const rows = await database.getAllAsync<ExerciseRow>(
    `SELECT * FROM exercises WHERE status = 'active' ORDER BY name_pt COLLATE NOCASE`,
  );
  const needle = query.q?.trim().toLocaleLowerCase('pt-BR') ?? '';
  return rows
    .map(mapExercise)
    .filter((exercise) => (query.origin ? exercise.origin === query.origin : true))
    .filter((exercise) => {
      if (!needle) {
        return true;
      }
      return (
        exercise.namePt.toLocaleLowerCase('pt-BR').includes(needle) ||
        (exercise.alternativeName ?? '').toLocaleLowerCase('pt-BR').includes(needle)
      );
    });
}

export async function readLocalExercise(
  userId: string,
  exerciseId: string,
): Promise<ExerciseView | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<ExerciseRow>(
    `SELECT * FROM exercises WHERE id = ?`,
    exerciseId,
  );
  return row ? mapExercise(row) : null;
}

export async function saveExercise(
  userId: string,
  input: ExerciseWrite & { id?: string },
  online: boolean,
): Promise<ExerciseView> {
  const database = await openLocalDatabase(userId);
  const id = await localTransaction(database, async (tx) => {
    const current = input.id
      ? await tx.getFirstAsync<ExerciseRow>(`SELECT * FROM exercises WHERE id = ?`, input.id)
      : null;
    if (current && !current.editable)
      throw new Error('Exercícios da biblioteca geral não podem ser editados.');
    const view = exerciseFromWrite(current, input);
    await saveCatalogRevision(tx, 'exercise', view);
    return view.id;
  });
  if (online) await syncCatalog(userId);
  return (await readLocalExercise(userId, id))!;
}

export async function archiveExercise(
  userId: string,
  exerciseId: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  await localTransaction(database, async (tx) => {
    const current = await tx.getFirstAsync<ExerciseRow>(
      `SELECT * FROM exercises WHERE id = ?`,
      exerciseId,
    );
    if (!current || !current.editable)
      throw new Error('Exercícios da biblioteca geral não podem ser arquivados.');
    await saveCatalogRevision(tx, 'exercise', { ...mapExercise(current), status: 'archived' });
  });
  if (online) await syncCatalog(userId);
}

export async function localEntityError(userId: string, entityId: string): Promise<string | null> {
  const database = await openLocalDatabase(userId);
  const row = await database.getFirstAsync<{ last_error: string | null }>(
    `SELECT last_error FROM sync_queue WHERE entity_id = ? AND status = 'error' ORDER BY updated_at DESC LIMIT 1`,
    entityId,
  );
  if (!row) {
    return null;
  }
  if (row.last_error === 'version_mismatch') {
    return 'O servidor tem outra versão. Descarte a alteração local para ver a versão salva.';
  }
  return 'Não foi possível sincronizar esta alteração.';
}

export async function discardLocalChange(userId: string, entityId: string): Promise<void> {
  const database = await openLocalDatabase(userId);
  await database.runAsync(`DELETE FROM sync_queue WHERE entity_id = ?`, entityId);
  await database.runAsync(`UPDATE gyms SET pending = 0 WHERE id = ?`, entityId);
  await database.runAsync(`UPDATE equipment SET pending = 0 WHERE id = ?`, entityId);
  await database.runAsync(`UPDATE exercises SET pending = 0 WHERE id = ?`, entityId);
}

export function syncCatalog(userId: string): Promise<SyncReport> {
  return singleSync(userId, 'catalog', () => runCatalogSync(userId));
}

const catalogTypes: ('gym' | 'equipment' | 'exercise')[] = ['gym', 'equipment', 'exercise'];
async function runCatalogSync(userId: string): Promise<SyncReport> {
  const database = await openLocalDatabase(userId);
  // Repair legacy dirty rows whose latest revision has no operation yet.
  await localTransaction(database, async (tx) => {
    for (const type of catalogTypes) {
      const rows = await tx.getAllAsync<{ id: string; local_revision: number }>(
        `SELECT id, local_revision FROM ${syncTable(type)} WHERE pending = 1`,
      );
      for (const row of rows) {
        const queued = await tx.getFirstAsync(
          `SELECT id FROM sync_queue WHERE entity_type = ? AND entity_id = ? AND local_revision = ? AND status IN ('pending','in_flight','error')`,
          type,
          row.id,
          row.local_revision,
        );
        if (!queued) {
          const view = await catalogView(tx, type, row.id);
          if (view)
            await enqueue(
              tx,
              type,
              row.id,
              (await revision(tx, type, row.id))!.version || null,
              catalogPayload(type, view),
              row.local_revision,
            );
        }
      }
    }
  });
  const queued = await claimOperations(database, catalogTypes);
  let conflicts = 0;
  try {
    if (queued.length) {
      const result = await pushCatalogSync(queued.map(toOperation));
      for (const item of result.results) {
        const row = queued.find((candidate) => candidate.id === item.id);
        if (!row) continue;
        if (item.status === 'applied') await acknowledge(database, row);
        else {
          conflicts += item.status === 'conflict' ? 1 : 0;
          await localTransaction(database, async (tx) => {
            await tx.runAsync(
              `UPDATE sync_queue SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
              item.code ?? item.status,
              new Date().toISOString(),
              item.id,
            );
          });
        }
      }
    }
    await releaseOperations(database, queued);
    await refreshSnapshot(database);
    await flushPhotos(database);
  } catch (error) {
    await releaseOperations(database, queued);
    if (isNetworkError(error)) return { synced: false, conflicts };
    throw error;
  }
  const photos = await database.getFirstAsync(
    `SELECT id FROM equipment WHERE photo_pending <> 0 LIMIT 1`,
  );
  return { synced: !photos && !(await hasPending(database, catalogTypes)), conflicts };
}

async function refreshSnapshot(database: Database): Promise<void> {
  const captured = new Map(
    await Promise.all(
      catalogTypes.map(async (type) => [type, await captureRevisions(database, type)] as const),
    ),
  );
  const snapshot = await pullCatalogSnapshot();
  await localTransaction(database, async (tx) => {
    for (const type of catalogTypes) {
      const rows = snapshot[syncTable(type) as 'gyms' | 'equipment' | 'exercises'];
      const ids = new Set(rows.map((row) => row.id));
      const before = captured.get(type)!;
      for (const [id, state] of before) {
        if (
          !ids.has(id) &&
          (await canApplyRemote(tx, type, id, state.local_revision, state.version))
        ) {
          // Deletion is conditional on BOTH local and remote versions captured before the GET.
          await tx.runAsync(
            `DELETE FROM ${syncTable(type)} WHERE id = ? AND local_revision = ? AND version = ? AND pending = 0`,
            id,
            state.local_revision,
            state.version,
          );
        }
      }
      for (const row of rows) {
        if (
          await canApplyRemote(
            tx,
            type,
            row.id,
            before.get(row.id)?.local_revision ?? 0,
            row.version,
          )
        ) {
          if (type === 'gym') await writeGym(tx, row as GymView, 0, 1);
          else if (type === 'equipment') {
            const previous = await tx.getFirstAsync<EquipmentRow>(
              `SELECT * FROM equipment WHERE id = ?`,
              row.id,
            );
            await writeEquipment(tx, row as EquipmentView, 0, 1, previous);
          } else await writeExercise(tx, row as ExerciseView, 0, 1);
        }
      }
    }
  });
}

async function catalogView(
  db: Database,
  type: 'gym' | 'equipment' | 'exercise',
  id: string,
): Promise<GymView | EquipmentView | ExerciseView | null> {
  if (type === 'gym') {
    const row = await db.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, id);
    return row ? mapGym(row) : null;
  }
  if (type === 'equipment') {
    const row = await db.getFirstAsync<EquipmentRow>(`SELECT * FROM equipment WHERE id = ?`, id);
    return row ? mapEquipment(row) : null;
  }
  const row = await db.getFirstAsync<ExerciseRow>(`SELECT * FROM exercises WHERE id = ?`, id);
  return row ? mapExercise(row) : null;
}

function catalogPayload(
  type: 'gym' | 'equipment' | 'exercise',
  view: GymView | EquipmentView | ExerciseView,
): unknown {
  return type === 'gym'
    ? gymSyncPayloadSchema.parse(view)
    : type === 'equipment'
      ? equipmentSyncPayloadSchema.parse(view)
      : exerciseSyncPayloadSchema.parse(view);
}

async function saveCatalogRevision(
  db: Database,
  type: 'gym' | 'equipment' | 'exercise',
  view: GymView | EquipmentView | ExerciseView,
): Promise<void> {
  const current = await revision(db, type, view.id);
  const next = (current?.local_revision ?? 0) + 1;
  if (type === 'gym') await writeGym(db, view as GymView, 1, 0);
  else if (type === 'equipment')
    await writeEquipment(
      db,
      view as EquipmentView,
      1,
      0,
      await db.getFirstAsync<EquipmentRow>(`SELECT * FROM equipment WHERE id = ?`, view.id),
    );
  else await writeExercise(db, view as ExerciseView, 1, 0);
  await db.runAsync(
    `UPDATE ${syncTable(type)} SET local_revision = ?, version = ? WHERE id = ?`,
    next,
    current?.version ?? 0,
    view.id,
  );
  await enqueue(db, type, view.id, current?.version || null, catalogPayload(type, view), next);
}

async function flushPhotos(database: Database): Promise<void> {
  const uploads = await database.getAllAsync<EquipmentRow>(
    `SELECT * FROM equipment WHERE photo_pending = 1 AND pending = 0 AND synced = 1 AND photo_base64 IS NOT NULL AND photo_content_type IS NOT NULL`,
  );
  for (const row of uploads) {
    if (!row.photo_base64 || !isPhotoType(row.photo_content_type)) {
      continue;
    }
    await uploadEquipmentPhotoRequest(row.gym_id, row.id, row.photo_content_type, row.photo_base64);
    await database.runAsync(
      `UPDATE equipment SET photo_pending = 0, has_photo = 1 WHERE id = ?`,
      row.id,
    );
  }
  const removals = await database.getAllAsync<EquipmentRow>(
    `SELECT * FROM equipment WHERE photo_pending = 2 AND pending = 0 AND synced = 1`,
  );
  for (const row of removals) {
    await deleteEquipmentPhotoRequest(row.gym_id, row.id);
    await database.runAsync(
      `UPDATE equipment SET photo_pending = 0, has_photo = 0 WHERE id = ?`,
      row.id,
    );
  }
}

async function enqueue(
  database: Database,
  entityType: string,
  entityId: string,
  baseVersion: number | null,
  payload: unknown,
  localRevision: number,
): Promise<void> {
  const plain = JSON.parse(JSON.stringify(payload)) as unknown;
  const payloadHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJsonString(plain),
  );
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key, payload_hash, payload, base_version, status, created_at, updated_at, local_revision
    ) VALUES (?, ?, ?, 'upsert', ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    Crypto.randomUUID(),
    entityType,
    entityId,
    Crypto.randomUUID(),
    payloadHash,
    JSON.stringify(plain),
    baseVersion,
    now,
    now,
    localRevision,
  );
}

function toOperation(row: QueuedRevision) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    baseVersion: row.base_version,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload) as unknown,
  };
}

async function writeGym(
  database: Database,
  gym: GymView,
  pending: number,
  synced: number,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO gyms (id, name, nickname, branch_name, city, notes, status, is_preferred, version, updated_at, pending, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, nickname = excluded.nickname, branch_name = excluded.branch_name, city = excluded.city,
       notes = excluded.notes, status = excluded.status, is_preferred = excluded.is_preferred, version = excluded.version,
       updated_at = excluded.updated_at, pending = excluded.pending, synced = excluded.synced`,
    gym.id,
    gym.name,
    gym.nickname,
    gym.branchName,
    gym.city,
    gym.notes,
    gym.status,
    gym.isPreferred ? 1 : 0,
    gym.version,
    gym.updatedAt,
    pending,
    synced,
  );
}

async function writeEquipment(
  database: Database,
  equipment: EquipmentView,
  pending: number,
  synced: number,
  previous: EquipmentRow | null,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO equipment (
      id, gym_id, name, machine_number, nickname, notes, status, has_photo, photo_base64, photo_content_type,
      photo_pending, exercise_ids, version, updated_at, pending, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      gym_id = excluded.gym_id, name = excluded.name, machine_number = excluded.machine_number, nickname = excluded.nickname,
      notes = excluded.notes, status = excluded.status, has_photo = excluded.has_photo, exercise_ids = excluded.exercise_ids,
      version = excluded.version, updated_at = excluded.updated_at, pending = excluded.pending, synced = excluded.synced,
      photo_base64 = COALESCE(excluded.photo_base64, equipment.photo_base64),
      photo_content_type = COALESCE(excluded.photo_content_type, equipment.photo_content_type),
      photo_pending = CASE WHEN excluded.photo_base64 IS NULL THEN equipment.photo_pending ELSE excluded.photo_pending END`,
    equipment.id,
    equipment.gymId,
    equipment.name,
    equipment.machineNumber,
    equipment.nickname,
    equipment.notes,
    equipment.status,
    equipment.hasPhoto || previous?.has_photo ? 1 : 0,
    previous?.photo_base64 ?? null,
    previous?.photo_content_type ?? null,
    previous?.photo_pending ?? 0,
    JSON.stringify(equipment.exerciseIds),
    equipment.version,
    equipment.updatedAt,
    pending,
    synced,
  );
}

async function writeExercise(
  database: Database,
  exercise: ExerciseView,
  pending: number,
  synced: number,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO exercises (
      id, origin, name_pt, alternative_name, activity_type, description, instructions, primary_muscle,
      secondary_muscles, equipment_types, status, editable, version, pending, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      origin = excluded.origin, name_pt = excluded.name_pt, alternative_name = excluded.alternative_name,
      activity_type = excluded.activity_type, description = excluded.description, instructions = excluded.instructions,
      primary_muscle = excluded.primary_muscle, secondary_muscles = excluded.secondary_muscles,
      equipment_types = excluded.equipment_types, status = excluded.status, editable = excluded.editable,
      version = excluded.version, pending = excluded.pending, synced = excluded.synced`,
    exercise.id,
    exercise.origin,
    exercise.namePt,
    exercise.alternativeName,
    exercise.activityType,
    exercise.description,
    exercise.instructions,
    exercise.primaryMuscle,
    JSON.stringify(exercise.secondaryMuscles),
    JSON.stringify(exercise.equipmentTypes),
    exercise.status,
    exercise.editable ? 1 : 0,
    exercise.version,
    pending,
    synced,
  );
}

function gymFromWrite(current: GymRow | null, input: GymWrite & { id?: string }): GymView {
  const now = new Date().toISOString();
  return {
    id: current?.id ?? input.id ?? Crypto.randomUUID(),
    name: input.name,
    nickname: input.nickname ?? null,
    branchName: input.branchName ?? null,
    city: input.city ?? null,
    notes: input.notes ?? null,
    status: current?.status === 'archived' ? 'archived' : 'active',
    isPreferred: input.isPreferred ?? false,
    version: current?.version ?? 1,
    createdAt: now,
    updatedAt: now,
  };
}

function equipmentFromWrite(
  current: EquipmentRow | null,
  gymId: string,
  input: EquipmentWrite & { id?: string },
): EquipmentView {
  const now = new Date().toISOString();
  return {
    id: current?.id ?? input.id ?? Crypto.randomUUID(),
    gymId,
    name: input.name,
    machineNumber: input.machineNumber ?? null,
    nickname: input.nickname ?? null,
    notes: input.notes ?? null,
    status: current?.status === 'archived' ? 'archived' : 'active',
    hasPhoto: Boolean(current?.has_photo),
    exerciseIds: input.exerciseIds ?? [],
    version: current?.version ?? 1,
    createdAt: now,
    updatedAt: now,
  };
}

function exerciseFromWrite(
  current: ExerciseRow | null,
  input: ExerciseWrite & { id?: string },
): ExerciseView {
  return {
    id: current?.id ?? input.id ?? Crypto.randomUUID(),
    origin: 'user',
    namePt: input.namePt,
    alternativeName: input.alternativeName ?? null,
    activityType: input.activityType,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    primaryMuscle: input.primaryMuscle,
    secondaryMuscles: input.secondaryMuscles,
    equipmentTypes: input.equipmentTypes,
    status: current?.status === 'archived' ? 'archived' : 'active',
    editable: true,
    version: current?.version ?? 1,
  };
}

function mapGym(row: GymRow): GymView {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    branchName: row.branch_name,
    city: row.city,
    notes: row.notes,
    status: row.status === 'archived' ? 'archived' : 'active',
    isPreferred: row.is_preferred === 1,
    version: row.version,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function mapEquipment(row: EquipmentRow): EquipmentView {
  return {
    id: row.id,
    gymId: row.gym_id,
    name: row.name,
    machineNumber: row.machine_number,
    nickname: row.nickname,
    notes: row.notes,
    status: row.status === 'archived' ? 'archived' : 'active',
    hasPhoto: row.has_photo === 1,
    exerciseIds: parseIds(row.exercise_ids),
    version: row.version,
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function mapExercise(row: ExerciseRow): ExerciseView {
  return {
    id: row.id,
    origin: row.origin === 'system' ? 'system' : 'user',
    namePt: row.name_pt,
    alternativeName: row.alternative_name,
    activityType: row.activity_type as ExerciseView['activityType'],
    description: row.description,
    instructions: row.instructions,
    primaryMuscle: (row.primary_muscle as ExerciseView['primaryMuscle']) ?? null,
    secondaryMuscles: parseIds(row.secondary_muscles) as ExerciseView['secondaryMuscles'],
    equipmentTypes: parseIds(row.equipment_types) as ExerciseView['equipmentTypes'],
    status: row.status === 'archived' ? 'archived' : 'active',
    editable: row.editable === 1,
    version: row.version,
  };
}

function photoUri(row: EquipmentRow): string | null {
  if (!row.photo_base64 || !row.photo_content_type) {
    return null;
  }
  return `data:${row.photo_content_type};base64,${row.photo_base64}`;
}

function parseIds(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function isPhotoType(value: string | null): value is 'image/jpeg' | 'image/png' | 'image/webp' {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

type GymRow = {
  id: string;
  name: string;
  nickname: string | null;
  branch_name: string | null;
  city: string | null;
  notes: string | null;
  status: string;
  is_preferred: number;
  version: number;
  updated_at: string;
  pending: number;
  synced: number;
};

type EquipmentRow = {
  id: string;
  gym_id: string;
  name: string;
  machine_number: string | null;
  nickname: string | null;
  notes: string | null;
  status: string;
  has_photo: number;
  photo_base64: string | null;
  photo_content_type: string | null;
  photo_pending: number;
  exercise_ids: string;
  version: number;
  updated_at: string;
  pending: number;
  synced: number;
};

type ExerciseRow = {
  id: string;
  origin: string;
  name_pt: string;
  alternative_name: string | null;
  activity_type: string;
  description: string | null;
  instructions: string | null;
  primary_muscle: string | null;
  secondary_muscles: string;
  equipment_types: string;
  status: string;
  editable: number;
  version: number;
  pending: number;
  synced: number;
};
