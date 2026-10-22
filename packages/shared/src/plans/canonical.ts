import { canonicalJsonString } from '../sync/canonical-json';
import { planSyncPayloadSchema } from './contracts';

/** Prescribed semantics, excluding server timestamps and display-only catalog labels. */
export function canonicalPlanContent(value: unknown): string {
  const plan = planSyncPayloadSchema.parse(value);
  return canonicalJsonString({
    ...plan,
    accent: plan.accent ?? null,
    exercises: plan.exercises
      .map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        orderIndex: exercise.orderIndex,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes,
        sets: exercise.sets
          .map((set) => ({ ...set, durationSeconds: set.durationSeconds ?? null }))
          .sort((a, b) => a.setIndex - b.setIndex),
        equipment: exercise.equipment
          .map((item) => ({ gymId: item.gymId, equipmentId: item.equipmentId }))
          .sort(
            (a, b) => a.gymId.localeCompare(b.gymId) || a.equipmentId.localeCompare(b.equipmentId),
          ),
      }))
      .sort((a, b) => a.orderIndex - b.orderIndex),
  });
}
