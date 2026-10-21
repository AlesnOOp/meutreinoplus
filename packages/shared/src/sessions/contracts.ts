import { z } from 'zod';
import { LOAD_UNITS, planSyncPayloadSchema } from '../plans/contracts';
import { normalizeLoad } from '../plans/load';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

const loadSchema = z
  .string()
  .trim()
  .regex(/^\d{1,4}(?:\.\d{1,2})?$/, 'Informe a carga com até duas casas decimais.')
  .nullable()
  .optional()
  .transform((value) => (value ? normalizeLoad(value) : null));

export const SESSION_STATUSES = ['in_progress', 'paused', 'completed', 'aborted'] as const;
export const EXERCISE_SESSION_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
] as const;
export const PERFORMED_SET_OUTCOMES = ['completed', 'skipped'] as const;
export const SESSION_TIME_KINDS = [
  'pause',
  'resume',
  'rest_start',
  'rest_pause',
  'rest_resume',
  'rest_finish',
] as const;

export const SESSION_STATUS_LABELS_PT: Record<(typeof SESSION_STATUSES)[number], string> = {
  in_progress: 'Em andamento',
  paused: 'Pausado',
  completed: 'Concluído',
  aborted: 'Cancelado',
};

export const sessionPlanSnapshotSchema = planSyncPayloadSchema.extend({
  version: z.number().int().nonnegative(),
  duplicatedFromId: z
    .uuid()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  archivedAt: z.iso.datetime().nullable().optional(),
});

const performedLoadSchema = z.object({
  repetitions: z.number().int().min(0).max(999).nullable(),
  load: z.string().nullable(),
  loadUnit: z.enum(LOAD_UNITS).nullable(),
});

export const sessionExerciseSyncSchema = z.object({
  id: z.uuid(),
  planExerciseId: z.uuid(),
  exerciseId: z.uuid(),
  name: z.string().min(1).max(160),
  orderIndex: z.number().int().min(1).max(40),
  status: z.enum(EXERCISE_SESSION_STATUSES),
  skipReason: z.string().nullable(),
  gymName: z.string().nullable(),
  equipmentName: z.string().nullable(),
  machineNumber: z.string().nullable(),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
});

export const performedSetSyncSchema = performedLoadSchema.extend({
  id: z.uuid(),
  exerciseSessionId: z.uuid(),
  plannedSetId: z.uuid().nullable(),
  setIndex: z.number().int().min(1).max(40),
  plannedRepetitions: z.number().int().min(0).max(999).nullable(),
  plannedLoad: z.string().nullable(),
  plannedLoadUnit: z.enum(LOAD_UNITS).nullable(),
  outcome: z.enum(PERFORMED_SET_OUTCOMES),
  completedAt: z.iso.datetime(),
  notes: z.string().nullable(),
});

export const performedCorrectionSyncSchema = performedLoadSchema.extend({
  id: z.uuid(),
  performedSetId: z.uuid(),
  voided: z.boolean(),
  reason: z.string().min(1).max(300),
  createdAt: z.iso.datetime(),
});

export const sessionFeedbackSyncSchema = z.object({
  id: z.uuid(),
  exerciseSessionId: z.uuid(),
  perceivedLevel: z.number().int().min(1).max(5).nullable(),
  comment: z.string().nullable(),
});

export const sessionTimeEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(SESSION_TIME_KINDS),
  occurredAt: z.iso.datetime(),
  restDurationSeconds: z.number().int().min(0).max(3600).nullable(),
  exerciseSessionId: z.uuid().nullable(),
});

export const sessionSyncPayloadSchema = z.object({
  id: z.uuid(),
  planId: z.uuid(),
  planVersion: z.number().int().nonnegative(),
  planName: z.string().min(1).max(120),
  gymId: z.uuid().nullable(),
  gymName: z.string().nullable(),
  status: z.enum(SESSION_STATUSES),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  planSnapshot: sessionPlanSnapshotSchema,
  exerciseSessions: z.array(sessionExerciseSyncSchema).max(40),
  performedSets: z.array(performedSetSyncSchema).max(800),
  corrections: z.array(performedCorrectionSyncSchema).max(800),
  feedback: z.array(sessionFeedbackSyncSchema).max(40),
  timeEvents: z.array(sessionTimeEventSchema).max(400),
});

export const startSessionSchema = z.object({
  id: z.uuid().optional(),
  planId: z.uuid(),
  gymId: z.uuid().nullable().optional(),
  startedAt: z.iso.datetime().optional(),
  exerciseSessions: z
    .array(z.object({ id: z.uuid(), planExerciseId: z.uuid() }))
    .max(40)
    .optional(),
});

export const sessionMomentSchema = z.object({
  occurredAt: z.iso.datetime().optional(),
});

export const finishSessionSchema = sessionMomentSchema.extend({
  confirmIncomplete: z.boolean().default(false),
  notes: optionalText(2000),
});

export const cancelSessionSchema = sessionMomentSchema.extend({
  confirm: z.boolean(),
});

export const performedSetWriteSchema = z.object({
  id: z.uuid(),
  exerciseSessionId: z.uuid(),
  plannedSetId: z.uuid().nullable().optional(),
  setIndex: z.number().int().min(1).max(40).optional(),
  repetitions: z.number().int().min(0).max(999).nullable().optional(),
  load: loadSchema,
  loadUnit: z.enum(LOAD_UNITS).optional(),
  outcome: z.enum(PERFORMED_SET_OUTCOMES).default('completed'),
  completedAt: z.iso.datetime().optional(),
  notes: optionalText(500),
});

export const performedSetCorrectionSchema = z.object({
  id: z.uuid().optional(),
  repetitions: z.number().int().min(0).max(999).nullable().optional(),
  load: loadSchema,
  loadUnit: z.enum(LOAD_UNITS).optional(),
  voided: z.boolean().optional(),
  reason: z.string().trim().min(1).max(300),
});

export const skipExerciseSchema = z.object({
  reason: z.string().trim().min(1).max(200).optional(),
});

export const exerciseFeedbackWriteSchema = z
  .object({
    perceivedLevel: z.number().int().min(1).max(5).nullable().optional(),
    comment: optionalText(2000),
  })
  .refine((value) => value.perceivedLevel != null || value.comment, {
    message: 'Informe um comentário ou uma avaliação.',
  });

export const restActionSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'finish']),
  occurredAt: z.iso.datetime().optional(),
  durationSeconds: z.number().int().min(0).max(3600).optional(),
  exerciseSessionId: z.uuid().nullable().optional(),
});

export const sessionConflictResolveSchema = z.object({
  choice: z.enum(['keep_server', 'keep_local', 'keep_both']),
});

export const restViewSchema = z.object({
  remainingSeconds: z.number().int().nonnegative(),
  running: z.boolean(),
  paused: z.boolean(),
  durationSeconds: z.number().int().nonnegative(),
  exerciseSessionId: z.uuid().nullable(),
});

export const sessionResponseSchema = z.object({
  payload: sessionSyncPayloadSchema,
  version: z.number().int().positive(),
  activeSeconds: z.number().int().nonnegative(),
  elapsedSeconds: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nullable(),
  pausedAt: z.iso.datetime().nullable(),
  lockedAt: z.iso.datetime().nullable(),
  clockAdjusted: z.boolean(),
  rest: restViewSchema.nullable(),
  unfinished: z.boolean(),
});

export const sessionListItemSchema = z.object({
  id: z.uuid(),
  planId: z.uuid().nullable(),
  planName: z.string(),
  gymName: z.string().nullable(),
  status: z.enum(SESSION_STATUSES),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
});

export const openSessionSchema = z.object({
  session: sessionResponseSchema.nullable(),
});

export const sessionPageSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(sessionListItemSchema),
});

export const sessionSummarySchema = z.object({
  planName: z.string(),
  gymName: z.string().nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  activeSeconds: z.number().int().nonnegative(),
  elapsedSeconds: z.number().int().nonnegative(),
  completedExercises: z.number().int().nonnegative(),
  skippedExercises: z.number().int().nonnegative(),
  partialExercises: z.number().int().nonnegative(),
  plannedSets: z.number().int().nonnegative(),
  performedSets: z.number().int().nonnegative(),
  skippedSets: z.number().int().nonnegative(),
  loads: z.array(
    z.object({
      exerciseName: z.string(),
      setIndex: z.number().int(),
      plannedLoad: z.string().nullable(),
      plannedLoadUnit: z.enum(LOAD_UNITS).nullable(),
      load: z.string().nullable(),
      loadUnit: z.enum(LOAD_UNITS).nullable(),
    }),
  ),
  feedback: z.array(sessionFeedbackSyncSchema),
});

export type SessionSyncPayload = z.infer<typeof sessionSyncPayloadSchema>;
export type SessionExerciseSync = z.infer<typeof sessionExerciseSyncSchema>;
export type PerformedSetSync = z.infer<typeof performedSetSyncSchema>;
export type PerformedCorrectionSync = z.infer<typeof performedCorrectionSyncSchema>;
export type SessionTimeEvent = z.infer<typeof sessionTimeEventSchema>;
