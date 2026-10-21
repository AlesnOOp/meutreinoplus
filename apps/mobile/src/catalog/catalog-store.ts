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
  archiveEquipmentRequest,
  archiveExerciseRequest,
  archiveGymRequest,
  createEquipmentRequest,
  createExerciseRequest,
  createGymRequest,
  deleteEquipmentPhotoRequest,
  pullCatalogSnapshot,
  pushCatalogSync,
  updateEquipmentRequest,
  updateExerciseRequest,
  updateGymRequest,
  uploadEquipmentPhotoRequest,
} from '@/api/catalog';
import { isNetworkError } from '@/api/errors';
import { openLocalDatabase } from '@/db/local-database';
import { retainedLocalIds, syncBaseVersion } from '@/catalog/merge';

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
  const current = input.id
    ? await database.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, input.id)
    : null;
  if (online) {
    try {
      const saved = current
        ? await updateGymRequest(current.id, input)
        : await createGymRequest(input);
      if (saved.isPreferred) {
        await database.runAsync(`UPDATE gyms SET is_preferred = 0 WHERE id <> ?`, saved.id);
      }
      await writeGym(database, saved, 0, 1);
      return saved;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = gymFromWrite(current, input);
  if (view.isPreferred) {
    await database.runAsync(`UPDATE gyms SET is_preferred = 0 WHERE id <> ?`, view.id);
  }
  await writeGym(database, view, 1, current?.synced ?? 0);
  await enqueue(
    database,
    'gym',
    view.id,
    current?.synced ? syncBaseVersion(current.version) : null,
    gymSyncPayloadSchema.parse({
      id: view.id,
      name: view.name,
      nickname: view.nickname,
      branchName: view.branchName,
      city: view.city,
      notes: view.notes,
      isPreferred: view.isPreferred,
      status: view.status,
    }),
  );
  return view;
}

export async function archiveGym(userId: string, gymId: string, online: boolean): Promise<void> {
  const database = await openLocalDatabase(userId);
  const current = await database.getFirstAsync<GymRow>(`SELECT * FROM gyms WHERE id = ?`, gymId);
  if (!current) {
    return;
  }
  if (!current.synced) {
    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_id = ? AND status = 'pending'`,
      gymId,
    );
    await database.runAsync(`DELETE FROM gyms WHERE id = ?`, gymId);
    return;
  }
  if (online) {
    try {
      const saved = await archiveGymRequest(gymId);
      await writeGym(database, saved, 0, 1);
      return;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = { ...mapGym(current), status: 'archived' as const, isPreferred: false };
  await writeGym(database, view, 1, 1);
  await enqueue(
    database,
    'gym',
    gymId,
    syncBaseVersion(current.version),
    gymSyncPayloadSchema.parse({
      id: view.id,
      name: view.name,
      nickname: view.nickname,
      branchName: view.branchName,
      city: view.city,
      notes: view.notes,
      isPreferred: false,
      status: 'archived',
    }),
  );
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
  const current = input.id
    ? await database.getFirstAsync<EquipmentRow>(
        `SELECT * FROM equipment WHERE id = ? AND gym_id = ?`,
        input.id,
        gymId,
      )
    : null;
  if (online) {
    try {
      const saved = current
        ? await updateEquipmentRequest(gymId, current.id, input)
        : await createEquipmentRequest(gymId, input);
      await writeEquipment(database, saved, 0, 1, current);
      return saved;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = equipmentFromWrite(current, gymId, input);
  await writeEquipment(database, view, 1, current?.synced ?? 0, current);
  await enqueue(
    database,
    'equipment',
    view.id,
    current?.synced ? syncBaseVersion(current.version) : null,
    equipmentSyncPayloadSchema.parse({
      id: view.id,
      gymId: view.gymId,
      name: view.name,
      machineNumber: view.machineNumber,
      nickname: view.nickname,
      notes: view.notes,
      exerciseIds: view.exerciseIds,
      status: view.status,
    }),
  );
  return view;
}

export async function archiveEquipment(
  userId: string,
  gymId: string,
  equipmentId: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const current = await database.getFirstAsync<EquipmentRow>(
    `SELECT * FROM equipment WHERE id = ? AND gym_id = ?`,
    equipmentId,
    gymId,
  );
  if (!current) {
    return;
  }
  if (!current.synced) {
    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_id = ? AND status = 'pending'`,
      equipmentId,
    );
    await database.runAsync(`DELETE FROM equipment WHERE id = ?`, equipmentId);
    return;
  }
  if (online) {
    try {
      const saved = await archiveEquipmentRequest(gymId, equipmentId);
      await writeEquipment(database, saved, 0, 1, current);
      return;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = { ...mapEquipment(current), status: 'archived' as const };
  await writeEquipment(database, view, 1, 1, current);
  await enqueue(
    database,
    'equipment',
    equipmentId,
    syncBaseVersion(current.version),
    equipmentSyncPayloadSchema.parse({
      id: view.id,
      gymId: view.gymId,
      name: view.name,
      machineNumber: view.machineNumber,
      nickname: view.nickname,
      notes: view.notes,
      exerciseIds: view.exerciseIds,
      status: 'archived',
    }),
  );
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
  const current = input.id
    ? await database.getFirstAsync<ExerciseRow>(`SELECT * FROM exercises WHERE id = ?`, input.id)
    : null;
  if (current && !current.editable) {
    throw new Error('Exercícios da biblioteca geral não podem ser editados.');
  }
  if (online) {
    try {
      const saved = current
        ? await updateExerciseRequest(current.id, input)
        : await createExerciseRequest(input);
      await writeExercise(database, saved, 0, 1);
      return saved;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = exerciseFromWrite(current, input);
  await writeExercise(database, view, 1, current?.synced ?? 0);
  await enqueue(
    database,
    'exercise',
    view.id,
    current?.synced ? syncBaseVersion(current.version) : null,
    exerciseSyncPayloadSchema.parse({
      id: view.id,
      namePt: view.namePt,
      alternativeName: view.alternativeName,
      activityType: view.activityType,
      description: view.description,
      instructions: view.instructions,
      primaryMuscle: view.primaryMuscle,
      secondaryMuscles: view.secondaryMuscles,
      equipmentTypes: view.equipmentTypes,
      status: view.status,
    }),
  );
  return view;
}

export async function archiveExercise(
  userId: string,
  exerciseId: string,
  online: boolean,
): Promise<void> {
  const database = await openLocalDatabase(userId);
  const current = await database.getFirstAsync<ExerciseRow>(
    `SELECT * FROM exercises WHERE id = ?`,
    exerciseId,
  );
  if (!current || !current.editable) {
    throw new Error('Exercícios da biblioteca geral não podem ser arquivados.');
  }
  if (!current.synced) {
    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_id = ? AND status = 'pending'`,
      exerciseId,
    );
    await database.runAsync(`DELETE FROM exercises WHERE id = ?`, exerciseId);
    return;
  }
  if (online) {
    try {
      const saved = await archiveExerciseRequest(exerciseId);
      await writeExercise(database, saved, 0, 1);
      return;
    } catch (error) {
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }
  const view = { ...mapExercise(current), status: 'archived' as const };
  await writeExercise(database, view, 1, 1);
  await enqueue(
    database,
    'exercise',
    exerciseId,
    syncBaseVersion(current.version),
    exerciseSyncPayloadSchema.parse({
      id: view.id,
      namePt: view.namePt,
      alternativeName: view.alternativeName,
      activityType: view.activityType,
      description: view.description,
      instructions: view.instructions,
      primaryMuscle: view.primaryMuscle ?? 'other',
      secondaryMuscles: view.secondaryMuscles,
      equipmentTypes: view.equipmentTypes,
      status: 'archived',
    }),
  );
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

export async function syncCatalog(userId: string): Promise<SyncReport> {
  const database = await openLocalDatabase(userId);
  const queued = await database.getAllAsync<QueueRow>(
    `SELECT * FROM sync_queue WHERE status = 'pending' AND entity_type IN ('gym', 'equipment', 'exercise') ORDER BY created_at ASC LIMIT 20`,
  );
  let conflicts = 0;
  if (queued.length > 0) {
    const ids = queued.map((row) => row.id);
    await database.runAsync(
      `UPDATE sync_queue SET status = 'in_flight', updated_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
      new Date().toISOString(),
      ...ids,
    );
    try {
      const result = await pushCatalogSync(queued.map(toOperation));
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
          await markSynced(database, row.entity_type, row.entity_id);
        } else {
          conflicts += item.status === 'conflict' ? 1 : 0;
          await database.runAsync(
            `UPDATE sync_queue SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?`,
            item.code ?? item.status,
            new Date().toISOString(),
            item.id,
          );
        }
      }
    } catch (error) {
      await database.runAsync(
        `UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE status = 'in_flight'`,
        new Date().toISOString(),
      );
      if (isNetworkError(error)) {
        return { synced: false, conflicts: 0 };
      }
      throw error;
    }
  }
  try {
    await refreshSnapshot(database);
    await flushPhotos(database);
  } catch (error) {
    if (isNetworkError(error)) {
      return { synced: false, conflicts };
    }
    throw error;
  }
  return { synced: true, conflicts };
}

async function refreshSnapshot(database: Database): Promise<void> {
  const snapshot = await pullCatalogSnapshot();
  await mergeTable(
    database,
    'gyms',
    snapshot.gyms.map((gym) => gym.id),
  );
  for (const gym of snapshot.gyms) {
    const pending = await database.getFirstAsync<{ pending: number }>(
      `SELECT pending FROM gyms WHERE id = ?`,
      gym.id,
    );
    if (!pending?.pending) {
      await writeGym(database, gym, 0, 1);
    }
  }
  await mergeTable(
    database,
    'equipment',
    snapshot.equipment.map((item) => item.id),
  );
  for (const equipment of snapshot.equipment) {
    const pending = await database.getFirstAsync<EquipmentRow>(
      `SELECT * FROM equipment WHERE id = ?`,
      equipment.id,
    );
    if (!pending?.pending) {
      await writeEquipment(database, equipment, 0, 1, pending);
    }
  }
  await mergeTable(
    database,
    'exercises',
    snapshot.exercises.map((item) => item.id),
  );
  for (const exercise of snapshot.exercises) {
    const pending = await database.getFirstAsync<{ pending: number }>(
      `SELECT pending FROM exercises WHERE id = ?`,
      exercise.id,
    );
    if (!pending?.pending) {
      await writeExercise(database, exercise, 0, 1);
    }
  }
}

async function mergeTable(
  database: Database,
  table: 'gyms' | 'equipment' | 'exercises',
  remoteIds: string[],
): Promise<void> {
  const local = await database.getAllAsync<{ id: string; pending: number }>(
    `SELECT id, pending FROM ${table}`,
  );
  const keep = new Set(
    retainedLocalIds(
      local.map((row) => ({ id: row.id, pending: row.pending === 1 })),
      remoteIds,
    ),
  );
  for (const row of local) {
    if (!keep.has(row.id)) {
      await database.runAsync(`DELETE FROM ${table} WHERE id = ?`, row.id);
    }
  }
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
): Promise<void> {
  const plain = JSON.parse(JSON.stringify(payload)) as unknown;
  const payloadHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalJsonString(plain),
  );
  const now = new Date().toISOString();
  await database.runAsync(
    `DELETE FROM sync_queue WHERE entity_id = ? AND status = 'pending'`,
    entityId,
  );
  await database.runAsync(
    `INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, idempotency_key, payload_hash, payload, base_version, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'upsert', ?, ?, ?, ?, 'pending', ?, ?)`,
    Crypto.randomUUID(),
    entityType,
    entityId,
    Crypto.randomUUID(),
    payloadHash,
    JSON.stringify(plain),
    baseVersion,
    now,
    now,
  );
}

function toOperation(row: QueueRow) {
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

async function markSynced(database: Database, entityType: string, entityId: string): Promise<void> {
  const table =
    entityType === 'gym' ? 'gyms' : entityType === 'equipment' ? 'equipment' : 'exercises';
  await database.runAsync(`UPDATE ${table} SET pending = 0, synced = 1 WHERE id = ?`, entityId);
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

type QueueRow = {
  id: string;
  entity_type: 'gym' | 'equipment' | 'exercise';
  entity_id: string;
  operation: 'upsert';
  idempotency_key: string;
  payload_hash: string;
  payload: string;
  base_version: number | null;
  created_at: string;
};
