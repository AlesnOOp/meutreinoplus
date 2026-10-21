import { z } from 'zod';
import { LOAD_TYPES } from '../domain/catalog';
import { normalizeLoad } from './load';

export const PLAN_ACCENTS = [
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'teal',
  'pink',
] as const;
export const PLANNED_SET_KINDS = ['normal', 'warmup', 'preparatory', 'drop_set'] as const;
export const PLAN_CONFLICT_CHOICES = ['keep_server', 'keep_local', 'keep_both'] as const;
export const LOAD_UNITS = ['kg', 'lb'] as const;

export const PLAN_ACCENT_LABELS_PT: Record<(typeof PLAN_ACCENTS)[number], string> = {
  slate: 'Cinza',
  blue: 'Azul',
  green: 'Verde',
  amber: 'Âmbar',
  red: 'Vermelho',
  violet: 'Violeta',
  teal: 'Verde-azulado',
  pink: 'Rosa',
};

export const PLANNED_SET_KIND_LABELS_PT: Record<(typeof PLANNED_SET_KINDS)[number], string> = {
  normal: 'Normal',
  warmup: 'Aquecimento',
  preparatory: 'Preparatória',
  drop_set: 'Drop set',
};

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

export const planSetSchema = z.object({
  id: z.uuid(),
  setIndex: z.number().int().min(1).max(20),
  kind: z.enum(PLANNED_SET_KINDS).default('normal'),
  repetitions: z.number().int().min(1).max(999).nullable(),
  load: loadSchema,
  loadUnit: z.enum(LOAD_UNITS).default('kg'),
  loadType: z.enum(LOAD_TYPES).default('fixed'),
  durationSeconds: z.number().int().min(1).max(86400).nullable().optional(),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: optionalText(500),
});

export const planEquipmentPreferenceSchema = z.object({
  gymId: z.uuid(),
  gymName: z.string().nullable().optional(),
  equipmentId: z.uuid(),
  equipmentName: z.string().nullable().optional(),
  machineNumber: z.string().nullable().optional(),
  equipmentStatus: z.enum(['active', 'archived']).optional(),
});

export const planExerciseSchema = z.object({
  id: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string().optional(),
  orderIndex: z.number().int().min(1).max(40),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: optionalText(2000),
  equipment: z.array(planEquipmentPreferenceSchema).max(12).default([]),
  sets: z.array(planSetSchema).max(20).default([]),
});

export const planWriteSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da ficha.').max(120),
  description: optionalText(2000),
  accent: z.enum(PLAN_ACCENTS).nullable().optional(),
});

export const planCreateSchema = planWriteSchema.extend({
  id: z.uuid().optional(),
});

export const planVersionSchema = z.object({
  baseVersion: z.number().int().positive(),
});

export const planSyncPayloadSchema = planWriteSchema.extend({
  id: z.uuid(),
  status: z.enum(['active', 'archived']).default('active'),
  exercises: z.array(planExerciseSchema).max(40).default([]),
});

export const planSchema = planSyncPayloadSchema.extend({
  version: z.number().int().positive(),
  duplicatedFromId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

export const planPageSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  items: z.array(planSchema),
});

export const planExerciseWriteSchema = z.object({
  baseVersion: z.number().int().positive(),
  id: z.uuid().optional(),
  exerciseId: z.uuid(),
  restSeconds: z.number().int().min(0).max(3600).nullable().optional(),
  notes: optionalText(2000),
  equipment: z.array(planEquipmentPreferenceSchema).max(12).optional(),
  sets: z.array(planSetSchema).max(20).optional(),
});

export const planExerciseReplaceSchema = z.object({
  baseVersion: z.number().int().positive(),
  exerciseId: z.uuid(),
  preserveSets: z.boolean(),
});

export const planOrderSchema = z.object({
  baseVersion: z.number().int().positive(),
  orderedIds: z.array(z.uuid()).min(1).max(40),
});

export const planSetWriteSchema = planSetSchema.omit({ id: true, setIndex: true }).extend({
  baseVersion: z.number().int().positive(),
  id: z.uuid().optional(),
});

export const planConflictResolveSchema = z.object({
  choice: z.enum(PLAN_CONFLICT_CHOICES),
  payload: planSyncPayloadSchema.optional(),
});

export const planConflictSchema = z.object({
  id: z.uuid(),
  planId: z.uuid(),
  baseVersion: z.number().int().positive().nullable(),
  status: z.enum(['open', 'keep_server', 'keep_local', 'keep_both']),
  preservedPlanId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});

export const planConflictResultSchema = z.object({
  choice: z.enum(PLAN_CONFLICT_CHOICES),
  plan: planSchema,
  preservedPlan: planSchema.nullable(),
});

export type PlanView = z.infer<typeof planSchema>;
export type PlanSyncPayload = z.infer<typeof planSyncPayloadSchema>;
export type PlanSetInput = z.infer<typeof planSetSchema>;
export type PlanExerciseInput = z.infer<typeof planExerciseSchema>;
export type PlanConflictChoice = (typeof PLAN_CONFLICT_CHOICES)[number];
