import { z } from 'zod';
import { planSchema, planSyncMutationSchema } from './contracts';
import { syncOperationEnvelopeSchema } from '../sync/operation';
export const planClosingOperationSchema = syncOperationEnvelopeSchema.extend({
  entityType: z.literal('workout_plan'),
  operation: z.literal('upsert'),
  payload: planSyncMutationSchema,
});
export const planReconcileRequestSchema = z.object({
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
  choice: z.enum(['keep_server', 'keep_both']),
  descendants: z.enum(['archive', 'reapply']),
  sourceOriginId: z.uuid().nullable(),
  operations: z.array(planClosingOperationSchema).min(1).max(200),
});
export const planReconcileResultSchema = z.object({
  id: z.uuid(),
  choice: z.enum(['keep_server', 'keep_both']),
  plan: planSchema,
  preservedPlan: planSchema.nullable(),
  closed: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(['closed', 'applied']),
      originId: z.uuid().nullable(),
    }),
  ),
  derived: z
    .object({
      sourceOriginId: z.uuid(),
      operation: planClosingOperationSchema,
      revision: z.object({
        originId: z.uuid(),
        version: z.number().int().positive(),
        snapshot: planSchema,
      }),
    })
    .nullable(),
});
export type PlanReconcileRequest = z.infer<typeof planReconcileRequestSchema>;
export type PlanReconcileResult = z.infer<typeof planReconcileResultSchema>;
