import { HttpStatus } from '@nestjs/common';
import { sessionPlanSnapshotSchema, type SessionSyncPayload } from '@meutreino/shared';
import type { Prisma } from '../generated/prisma/client';
import { fail } from '../identity/http';

type ExistingSession = {
  id: string;
  userId: string;
  workoutPlanId: string | null;
  planVersion: number | null;
  planSnapshot: Prisma.JsonValue;
  gymId: string | null;
  exercises: Array<{ id: string; planExerciseId: string | null; exerciseId: string }>;
};

export function invalidSessionReferences(): never {
  // The same response for absent, foreign and wrong-aggregate references; never echo IDs.
  throw fail(
    HttpStatus.BAD_REQUEST,
    'invalid_session_references',
    'As referências do treino são inválidas.',
  );
}

function uniqueIds(rows: ReadonlyArray<{ id: string }>): void {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) invalidSessionReferences();
}

/** Call before writes or a successful receipt, in the SAME serializable transaction. */
export async function validateSessionReferences(
  tx: Prisma.TransactionClient,
  userId: string,
  payload: SessionSyncPayload,
  existing: ExistingSession | null,
): Promise<void> {
  if (
    existing &&
    (existing.id !== payload.id ||
      existing.userId !== userId ||
      existing.workoutPlanId !== payload.planId ||
      existing.planVersion !== payload.planVersion ||
      existing.gymId !== payload.gymId)
  ) {
    invalidSessionReferences();
  }
  const plan = await tx.workoutPlan.findFirst({
    where: { id: payload.planId, ownerUserId: userId },
  });
  if (!plan) invalidSessionReferences();
  const revision = await tx.workoutPlanRevision.findUnique({
    where: { planId_version: { planId: plan.id, version: payload.planVersion } },
  });
  if (!revision) invalidSessionReferences();
  if (
    payload.gymId &&
    !(await tx.gym.findFirst({ where: { id: payload.gymId, ownerUserId: userId } }))
  ) {
    invalidSessionReferences();
  }
  const canonical = sessionPlanSnapshotSchema.safeParse(
    existing?.planSnapshot ?? revision.snapshot,
  );
  if (
    !canonical.success ||
    payload.planSnapshot.id !== plan.id ||
    payload.planSnapshot.version !== payload.planVersion ||
    canonical.data.id !== plan.id ||
    (payload.planSnapshot.duplicatedFromId ?? null) !== (canonical.data.duplicatedFromId ?? null)
  ) {
    invalidSessionReferences();
  }
  const planned = new Map(canonical.data.exercises.map((exercise) => [exercise.id, exercise]));
  uniqueIds(payload.planSnapshot.exercises);
  for (const exercise of payload.planSnapshot.exercises) {
    const trusted = planned.get(exercise.id);
    if (!trusted || trusted.exerciseId !== exercise.exerciseId) invalidSessionReferences();
    uniqueIds(exercise.sets);
    for (const set of exercise.sets) {
      if (!trusted.sets.some((item) => item.id === set.id)) invalidSessionReferences();
    }
    for (const equipment of exercise.equipment) {
      if (
        !trusted.equipment.some(
          (item) => item.gymId === equipment.gymId && item.equipmentId === equipment.equipmentId,
        )
      ) {
        invalidSessionReferences();
      }
    }
  }
  for (const rows of [
    payload.exerciseSessions,
    payload.performedSets,
    payload.corrections,
    payload.feedback,
    payload.timeEvents,
  ]) {
    uniqueIds(rows);
  }

  if (
    new Set(payload.feedback.map((item) => item.exerciseSessionId)).size !== payload.feedback.length
  )
    invalidSessionReferences();
  const exercises = new Map(existing?.exercises.map((exercise) => [exercise.id, exercise]) ?? []);
  const storedExercises = await tx.exerciseSession.findMany({
    where: { id: { in: payload.exerciseSessions.map((exercise) => exercise.id) } },
  });
  for (const stored of storedExercises) {
    if (stored.workoutSessionId !== payload.id) invalidSessionReferences();
  }
  const storedById = new Map(storedExercises.map((exercise) => [exercise.id, exercise]));
  const planExerciseIds = payload.exerciseSessions.map((exercise) => exercise.planExerciseId);
  const planExercises = await tx.workoutPlanExercise.findMany({
    where: { id: { in: planExerciseIds } },
  });
  const planExercisesById = new Map(planExercises.map((exercise) => [exercise.id, exercise]));
  const visibleExercises = await tx.exercise.findMany({
    where: {
      id: { in: payload.exerciseSessions.map((exercise) => exercise.exerciseId) },
      OR: [{ origin: 'system', ownerUserId: null }, { ownerUserId: userId }],
    },
    select: { id: true },
  });
  const visibleIds = new Set(visibleExercises.map((exercise) => exercise.id));
  for (const exercise of payload.exerciseSessions) {
    const trusted = planned.get(exercise.planExerciseId);
    const row = planExercisesById.get(exercise.planExerciseId);
    const stored = storedById.get(exercise.id);
    if (
      !trusted ||
      trusted.exerciseId !== exercise.exerciseId ||
      !visibleIds.has(exercise.exerciseId) ||
      !row ||
      row.planId !== plan.id ||
      (existing && !stored) ||
      (stored &&
        (stored.planExerciseId !== exercise.planExerciseId ||
          stored.exerciseId !== exercise.exerciseId))
    ) {
      invalidSessionReferences();
    }
    exercises.set(exercise.id, exercise);
  }

  // Query targets too: a forged payload must not disguise a foreign existing set as a new local one.
  const storedSets = await tx.performedSet.findMany({
    where: {
      id: {
        in: [
          ...payload.performedSets.map((set) => set.id),
          ...payload.corrections.map((correction) => correction.performedSetId),
        ],
      },
    },
  });
  const sets = new Map(storedSets.map((set) => [set.id, set]));
  for (const set of storedSets) {
    if (!exercises.has(set.exerciseSessionId)) invalidSessionReferences();
  }
  for (const set of payload.performedSets) {
    const exercise = exercises.get(set.exerciseSessionId);
    const stored = sets.get(set.id);
    const plannedExercise = exercise?.planExerciseId
      ? planned.get(exercise.planExerciseId)
      : undefined;
    if (
      !exercise ||
      (stored &&
        (stored.exerciseSessionId !== set.exerciseSessionId ||
          stored.plannedSetId !== set.plannedSetId)) ||
      (set.plannedSetId && !plannedExercise?.sets.some((item) => item.id === set.plannedSetId))
    ) {
      invalidSessionReferences();
    }
  }
  const allowedSetIds = new Set([...sets.keys(), ...payload.performedSets.map((set) => set.id)]);
  const storedCorrections = await tx.performedSetCorrection.findMany({
    where: { id: { in: payload.corrections.map((correction) => correction.id) } },
  });
  const correctionsById = new Map(
    storedCorrections.map((correction) => [correction.id, correction]),
  );
  for (const correction of payload.corrections) {
    const stored = correctionsById.get(correction.id);
    if (
      !allowedSetIds.has(correction.performedSetId) ||
      (stored &&
        (stored.performedSetId !== correction.performedSetId ||
          stored.correctedByUserId !== userId))
    ) {
      invalidSessionReferences();
    }
  }
  const storedFeedback = await tx.exerciseFeedback.findMany({
    where: { id: { in: payload.feedback.map((item) => item.id) } },
  });
  const feedbackById = new Map(storedFeedback.map((feedback) => [feedback.id, feedback]));
  for (const feedback of payload.feedback) {
    const stored = feedbackById.get(feedback.id);
    if (
      !exercises.has(feedback.exerciseSessionId) ||
      (stored &&
        (stored.exerciseSessionId !== feedback.exerciseSessionId || stored.userId !== userId))
    ) {
      invalidSessionReferences();
    }
  }
  const storedEvents = await tx.sessionTimeEvent.findMany({
    where: { id: { in: payload.timeEvents.map((event) => event.id) } },
  });
  const eventsById = new Map(storedEvents.map((event) => [event.id, event]));
  for (const event of payload.timeEvents) {
    const stored = eventsById.get(event.id);
    if (
      (event.exerciseSessionId && !exercises.has(event.exerciseSessionId)) ||
      (stored &&
        (stored.workoutSessionId !== payload.id ||
          stored.exerciseSessionId !== event.exerciseSessionId))
    ) {
      invalidSessionReferences();
    }
  }
}
