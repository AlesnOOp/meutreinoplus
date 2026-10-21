import {
  catalogSnapshotSchema,
  equipmentPageSchema,
  equipmentSchema,
  exercisePageSchema,
  exerciseSchema,
  gymPageSchema,
  gymSchema,
  syncPushResultSchema,
  type EquipmentView,
  type EquipmentWrite,
  type ExerciseView,
  type ExerciseWrite,
  type GymView,
  type GymWrite,
} from '@meutreino/shared';
import { apiRequest } from '@/api/client';
import { readApiError } from '@/api/errors';
import { getApiBaseUrl } from '@/api/health';
import { readAccessToken } from '@/session/token-memory';

export type CatalogSnapshot = ReturnType<typeof catalogSnapshotSchema.parse>;
export type SyncPushResult = ReturnType<typeof syncPushResultSchema.parse>;

async function send<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  const body = await apiRequest(path, { method: init?.method, body: init?.body, auth: true });
  return schema.parse(body);
}

export function createGymRequest(input: GymWrite): Promise<GymView> {
  return send('/api/v1/gyms', gymSchema, { method: 'POST', body: input });
}

export function updateGymRequest(gymId: string, input: GymWrite): Promise<GymView> {
  return send(`/api/v1/gyms/${gymId}`, gymSchema, { method: 'PATCH', body: input });
}

export function archiveGymRequest(gymId: string): Promise<GymView> {
  return send(`/api/v1/gyms/${gymId}/archive`, gymSchema, { method: 'POST' });
}

export function listGymsRequest(page = 1): Promise<{ items: GymView[] }> {
  return send(`/api/v1/gyms?page=${page}&pageSize=50`, gymPageSchema);
}

export function createEquipmentRequest(
  gymId: string,
  input: EquipmentWrite,
): Promise<EquipmentView> {
  return send(`/api/v1/gyms/${gymId}/equipment`, equipmentSchema, { method: 'POST', body: input });
}

export function updateEquipmentRequest(
  gymId: string,
  equipmentId: string,
  input: EquipmentWrite,
): Promise<EquipmentView> {
  return send(`/api/v1/gyms/${gymId}/equipment/${equipmentId}`, equipmentSchema, {
    method: 'PATCH',
    body: input,
  });
}

export function archiveEquipmentRequest(
  gymId: string,
  equipmentId: string,
): Promise<EquipmentView> {
  return send(`/api/v1/gyms/${gymId}/equipment/${equipmentId}/archive`, equipmentSchema, {
    method: 'POST',
  });
}

export function listEquipmentRequest(gymId: string): Promise<{ items: EquipmentView[] }> {
  return send(`/api/v1/gyms/${gymId}/equipment?page=1&pageSize=50`, equipmentPageSchema);
}

export function uploadEquipmentPhotoRequest(
  gymId: string,
  equipmentId: string,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  dataBase64: string,
): Promise<void> {
  return apiRequest(`/api/v1/gyms/${gymId}/equipment/${equipmentId}/photo`, {
    method: 'POST',
    body: { contentType, dataBase64 },
    auth: true,
  }).then(() => undefined);
}

export function deleteEquipmentPhotoRequest(gymId: string, equipmentId: string): Promise<void> {
  return apiRequest(`/api/v1/gyms/${gymId}/equipment/${equipmentId}/photo`, {
    method: 'DELETE',
    auth: true,
  }).then(() => undefined);
}

export async function downloadEquipmentPhotoRequest(
  gymId: string,
  equipmentId: string,
): Promise<string | null> {
  const baseUrl = getApiBaseUrl();
  const accessToken = readAccessToken();
  if (!baseUrl || !accessToken) {
    return null;
  }
  const response = await fetch(`${baseUrl}/api/v1/gyms/${gymId}/equipment/${equipmentId}/photo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'image/*' },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw readApiError(response.status, null);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  return `data:${contentType};base64,${btoa(binary)}`;
}

export function createExerciseRequest(input: ExerciseWrite): Promise<ExerciseView> {
  return send('/api/v1/exercises', exerciseSchema, { method: 'POST', body: input });
}

export function updateExerciseRequest(
  exerciseId: string,
  input: ExerciseWrite,
): Promise<ExerciseView> {
  return send(`/api/v1/exercises/${exerciseId}`, exerciseSchema, { method: 'PATCH', body: input });
}

export function archiveExerciseRequest(exerciseId: string): Promise<ExerciseView> {
  return send(`/api/v1/exercises/${exerciseId}/archive`, exerciseSchema, { method: 'POST' });
}

export function listExercisesRequest(query: string): Promise<{ items: ExerciseView[] }> {
  return send(
    `/api/v1/exercises?page=1&pageSize=50&q=${encodeURIComponent(query)}`,
    exercisePageSchema,
  );
}

export function pullCatalogSnapshot(): Promise<CatalogSnapshot> {
  return send('/api/v1/sync/snapshot', catalogSnapshotSchema);
}

export function pushCatalogSync(operations: unknown[]): Promise<SyncPushResult> {
  return send('/api/v1/sync', syncPushResultSchema, { method: 'POST', body: { operations } });
}
