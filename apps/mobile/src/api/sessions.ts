import {
  openSessionSchema,
  conflictPreviewSchema,
  sessionResolutionSchema,
  sessionVariantsSchema,
  sessionConflictPreviewSchema,
  sessionConflictResolveSchema,
  sessionResponseSchema,
  sessionPageSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
import { z } from 'zod';
import { apiRequest } from '@/api/client';
import { pushCatalogSync } from '@/api/catalog';

async function send<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const body = await apiRequest(path, { method: init?.method, body: init?.body, auth: true });
  return schema.parse(body);
}

export function startSessionRequest(body: {
  id: string;
  planId: string;
  gymId: string | null;
  startedAt: string;
  exerciseSessions: { id: string; planExerciseId: string }[];
}) {
  return send('/api/v1/workout-sessions', sessionResponseSchema, { method: 'POST', body });
}

export function openSessionRequest() {
  return send('/api/v1/workout-sessions/open', openSessionSchema);
}

export function getSessionRequest(sessionId: string) {
  return send(`/api/v1/workout-sessions/${sessionId}`, sessionResponseSchema);
}

export function previewSessionConflictRequest(
  conflictId: string,
  body: z.infer<typeof sessionConflictPreviewSchema>,
) {
  return send(`/api/v1/workout-session-conflicts/${conflictId}/preview`, conflictPreviewSchema, {
    method: 'POST',
    body,
  });
}
export function resolveSessionConflictRequest(
  conflictId: string,
  body: z.infer<typeof sessionConflictResolveSchema>,
) {
  return send(`/api/v1/workout-session-conflicts/${conflictId}/resolve`, sessionResolutionSchema, {
    method: 'POST',
    body,
  });
}
export function sessionVariantsRequest(sessionId: string) {
  return send(`/api/v1/workout-sessions/${sessionId}/variants`, sessionVariantsSchema);
}

export function pushSessionSync(operations: unknown[]) {
  return pushCatalogSync(operations);
}

export type { SessionSyncPayload };

export function listSessionPageRequest(page: number) {
  return send(`/api/v1/workout-sessions?page=${page}&pageSize=50`, sessionPageSchema);
}
