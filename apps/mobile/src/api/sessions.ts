import {
  openSessionSchema,
  sessionResponseSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
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

export function resolveSessionConflictRequest(
  conflictId: string,
  choice: 'keep_server' | 'keep_local' | 'keep_both',
) {
  return send(`/api/v1/workout-session-conflicts/${conflictId}/resolve`, sessionResponseSchema, {
    method: 'POST',
    body: { choice },
  });
}

export function pushSessionSync(operations: unknown[]) {
  return pushCatalogSync(operations);
}

export type { SessionSyncPayload };
