import {
  planConflictResultSchema,
  planPageSchema,
  type PlanConflictChoice,
  type PlanSyncPayload,
  type PlanView,
} from '@meutreino/shared';
import { apiRequest } from '@/api/client';

async function send<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const body = await apiRequest(path, { method: init?.method, body: init?.body, auth: true });
  return schema.parse(body);
}

export function listPlansRequest(
  page: number,
  includeArchived: boolean,
): Promise<{ page: number; pageSize: number; total: number; items: PlanView[] }> {
  return send(
    `/api/v1/workout-plans?page=${page}&pageSize=50&includeArchived=${includeArchived ? 'true' : 'false'}`,
    planPageSchema,
  );
}

export function resolvePlanConflictRequest(
  conflictId: string,
  choice: PlanConflictChoice,
  payload?: PlanSyncPayload,
): Promise<{ choice: PlanConflictChoice; plan: PlanView; preservedPlan: PlanView | null }> {
  return send(`/api/v1/workout-plan-conflicts/${conflictId}/resolve`, planConflictResultSchema, {
    method: 'POST',
    body: { choice, payload },
  });
}
