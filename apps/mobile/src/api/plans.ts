import {
  planConflictResultSchema,
  planPageSchema,
  planSchema,
  planReconcileResultSchema,
  type PlanReconcileRequest,
  sessionPlanSnapshotSchema,
  type PlanConflictChoice,
  type PlanSyncPayload,
  type PlanView,
} from '@meutreino/shared';
import { z } from 'zod';
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
): Promise<ReturnType<typeof planConflictResultSchema.parse>> {
  return send(`/api/v1/workout-plan-conflicts/${conflictId}/resolve`, planConflictResultSchema, {
    method: 'POST',
    body: { choice, payload },
  });
}

export function getPlanRevisionRequest(planId: string, version: number) {
  return send(
    `/api/v1/workout-plans/${planId}/revisions/${version}`,
    z.object({ version: z.number().int().positive(), snapshot: sessionPlanSnapshotSchema }),
  );
}

export function getPlanRequest(planId: string) {
  return send(`/api/v1/workout-plans/${planId}`, planSchema);
}
export function reconcilePlanConflictRequest(conflictId: string, body: PlanReconcileRequest) {
  return send(`/api/v1/workout-plan-conflicts/${conflictId}/reconcile`, planReconcileResultSchema, {
    method: 'POST',
    body,
  });
}
