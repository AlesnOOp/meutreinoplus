import { z } from 'zod';
import { SYNC_ENTITY_TYPES, SYNC_OPERATION_TYPES } from './decision';

export const syncOperationEnvelopeSchema = z.object({
  id: z.uuid(),
  entityType: z.enum(SYNC_ENTITY_TYPES),
  entityId: z.uuid(),
  operation: z.enum(SYNC_OPERATION_TYPES),
  idempotencyKey: z.string().trim().min(1).max(200),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  baseVersion: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
});

export type SyncOperationEnvelope = z.infer<typeof syncOperationEnvelopeSchema>;
