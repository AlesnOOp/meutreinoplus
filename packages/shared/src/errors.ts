import { z } from 'zod';

export const apiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(apiErrorDetailSchema).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('meutreino-api'),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});

export type HealthReport = z.infer<typeof healthReportSchema>;
