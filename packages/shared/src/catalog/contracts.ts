import { z } from 'zod';
import { planSchema } from '../plans/contracts';
import { ACTIVITY_TYPES, EQUIPMENT_TYPES, MUSCLE_GROUPS } from '../domain/catalog';

export const ARCHIVE_STATUSES = ['active', 'archived'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

export const gymWriteSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da academia.').max(120),
  nickname: optionalText(80),
  branchName: optionalText(80),
  city: optionalText(80),
  notes: optionalText(2000),
  isPreferred: z.boolean().optional(),
});

export const gymSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  nickname: z.string().nullable(),
  branchName: z.string().nullable(),
  city: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(ARCHIVE_STATUSES),
  isPreferred: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const equipmentWriteSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do equipamento.').max(120),
  machineNumber: optionalText(40),
  nickname: optionalText(80),
  notes: optionalText(2000),
  exerciseIds: z.array(z.uuid()).max(40).optional(),
});

export const equipmentSchema = z.object({
  id: z.uuid(),
  gymId: z.uuid(),
  name: z.string(),
  machineNumber: z.string().nullable(),
  nickname: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(ARCHIVE_STATUSES),
  hasPhoto: z.boolean(),
  exerciseIds: z.array(z.uuid()),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const exerciseWriteSchema = z.object({
  namePt: z.string().trim().min(1, 'Informe o nome do exercício.').max(160),
  alternativeName: optionalText(160),
  activityType: z.enum(ACTIVITY_TYPES),
  description: optionalText(2000),
  instructions: optionalText(2000),
  primaryMuscle: z.enum(MUSCLE_GROUPS),
  secondaryMuscles: z.array(z.enum(MUSCLE_GROUPS)).max(6).default([]),
  equipmentTypes: z.array(z.enum(EQUIPMENT_TYPES)).max(6).default([]),
});

export const exerciseSchema = z.object({
  id: z.uuid(),
  origin: z.enum(['system', 'user']),
  namePt: z.string(),
  alternativeName: z.string().nullable(),
  activityType: z.enum(ACTIVITY_TYPES),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  primaryMuscle: z.enum(MUSCLE_GROUPS).nullable(),
  secondaryMuscles: z.array(z.enum(MUSCLE_GROUPS)),
  equipmentTypes: z.array(z.enum(EQUIPMENT_TYPES)),
  status: z.enum(ARCHIVE_STATUSES),
  editable: z.boolean(),
  version: z.number().int().positive(),
});

export const pageSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export const gymSyncPayloadSchema = gymWriteSchema.extend({
  id: z.uuid(),
  status: z.enum(ARCHIVE_STATUSES).default('active'),
  isPreferred: z.boolean().default(false),
});

export const equipmentSyncPayloadSchema = equipmentWriteSchema.extend({
  id: z.uuid(),
  gymId: z.uuid(),
  status: z.enum(ARCHIVE_STATUSES).default('active'),
  exerciseIds: z.array(z.uuid()).max(40).default([]),
});

export const gymPageSchema = pageSchema.extend({ items: z.array(gymSchema) });
export const equipmentPageSchema = pageSchema.extend({ items: z.array(equipmentSchema) });
export const exercisePageSchema = pageSchema.extend({ items: z.array(exerciseSchema) });

export const catalogSnapshotSchema = z.object({
  gyms: z.array(gymSchema),
  equipment: z.array(equipmentSchema),
  exercises: z.array(exerciseSchema),
});

export const syncPushResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(['applied', 'rejected', 'conflict']),
      code: z.string().optional(),
      revision: z
        .object({ originId: z.uuid(), version: z.number().int().positive(), snapshot: planSchema })
        .optional(),
    }),
  ),
});

export const exerciseSyncPayloadSchema = exerciseWriteSchema.extend({
  id: z.uuid(),
  status: z.enum(ARCHIVE_STATUSES).default('active'),
});

export type GymView = z.infer<typeof gymSchema>;
export type GymWrite = z.infer<typeof gymWriteSchema>;
export type EquipmentView = z.infer<typeof equipmentSchema>;
export type EquipmentWrite = z.infer<typeof equipmentWriteSchema>;
export type ExerciseView = z.infer<typeof exerciseSchema>;
export type ExerciseWrite = z.infer<typeof exerciseWriteSchema>;
