import { canonicalJsonString } from '../sync/canonical-json';
import { activeSeconds, elapsedSeconds, restRemainingSeconds, type RestPause } from './clock';
import type {
  PerformedCorrectionSync,
  PerformedSetSync,
  SessionSyncPayload,
  SessionTimeEvent,
} from './contracts';

export type EffectiveSet = PerformedSetSync & { voided: boolean };

export type RestView = {
  remainingSeconds: number;
  running: boolean;
  paused: boolean;
  durationSeconds: number;
  exerciseSessionId: string | null;
};

export function performedSetFingerprint(set: {
  outcome: string;
  repetitions: number | null;
  load: string | null;
  loadUnit: string | null;
  notes: string | null;
}): string {
  return canonicalJsonString({
    outcome: set.outcome,
    repetitions: set.repetitions,
    load: set.load,
    loadUnit: set.loadUnit,
    notes: set.notes,
  });
}

export function mergePerformedSets<T extends { id: string; fingerprint: string }>(
  serverSets: readonly T[],
  clientSets: readonly T[],
): { accepted: T[]; divergent: Array<{ server: T; client: T }> } {
  const byId = new Map(serverSets.map((set) => [set.id, set]));
  const accepted: T[] = [];
  const divergent: Array<{ server: T; client: T }> = [];
  for (const client of clientSets) {
    const server = byId.get(client.id);
    if (!server) {
      accepted.push(client);
      continue;
    }
    if (server.fingerprint !== client.fingerprint) {
      divergent.push({ server, client });
    }
  }
  return { accepted, divergent };
}

export function effectiveSet(
  set: PerformedSetSync,
  corrections: readonly PerformedCorrectionSync[],
): EffectiveSet {
  const latest = corrections
    .filter((correction) => correction.performedSetId === set.id)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  if (!latest) {
    return { ...set, voided: false };
  }
  if (latest.voided) {
    return { ...set, voided: true };
  }
  return {
    ...set,
    voided: false,
    repetitions: latest.repetitions,
    load: latest.load,
    loadUnit: latest.loadUnit,
  };
}

export function projectClock(
  payload: SessionSyncPayload,
  now: string,
): {
  activeSeconds: number;
  elapsedSeconds: number;
} {
  return {
    activeSeconds: activeSeconds({
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      events: payload.timeEvents
        .filter((event) => event.kind === 'pause' || event.kind === 'resume')
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((event) => ({ kind: event.kind as 'pause' | 'resume', occurredAt: event.occurredAt })),
      now,
    }),
    elapsedSeconds: elapsedSeconds({
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      now,
    }),
  };
}

export function projectRest(events: readonly SessionTimeEvent[], now: string): RestView | null {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let current: {
    startedAt: string;
    durationSeconds: number;
    exerciseSessionId: string | null;
    pauses: RestPause[];
    finished: boolean;
  } | null = null;
  for (const event of ordered) {
    if (event.kind === 'rest_start') {
      current = {
        startedAt: event.occurredAt,
        durationSeconds: event.restDurationSeconds ?? 0,
        exerciseSessionId: event.exerciseSessionId,
        pauses: [],
        finished: false,
      };
      continue;
    }
    if (!current || current.finished) {
      continue;
    }
    if (event.kind === 'rest_pause' && !current.pauses.some((pause) => pause.resumedAt === null)) {
      current.pauses.push({ pausedAt: event.occurredAt, resumedAt: null });
    } else if (event.kind === 'rest_resume') {
      const open = [...current.pauses].reverse().find((pause) => pause.resumedAt === null);
      if (open) {
        open.resumedAt = event.occurredAt;
      }
    } else if (event.kind === 'rest_finish') {
      current.finished = true;
    }
  }
  if (!current || current.finished) {
    return null;
  }
  const remainingSeconds = restRemainingSeconds({
    startedAt: current.startedAt,
    durationSeconds: current.durationSeconds,
    pauses: current.pauses,
    now,
  });
  const paused = current.pauses.some((pause) => pause.resumedAt === null);
  if (remainingSeconds === 0 && !paused) {
    return null;
  }
  return {
    remainingSeconds,
    running: !paused && remainingSeconds > 0,
    paused,
    durationSeconds: current.durationSeconds,
    exerciseSessionId: current.exerciseSessionId,
  };
}

export function hasUnfinishedPlannedSets(payload: SessionSyncPayload): boolean {
  const exercises = new Map(
    payload.exerciseSessions.map((exercise) => [exercise.planExerciseId, exercise]),
  );
  for (const planned of payload.planSnapshot.exercises) {
    const exercise = exercises.get(planned.id);
    if (exercise?.status === 'skipped') {
      continue;
    }
    for (const plannedSet of planned.sets) {
      const done = payload.performedSets.some((set) => {
        if (set.plannedSetId !== plannedSet.id || set.outcome !== 'completed') {
          return false;
        }
        return !effectiveSet(set, payload.corrections).voided;
      });
      if (!done) {
        return true;
      }
    }
  }
  return false;
}

export function sessionSummary(payload: SessionSyncPayload, now: string) {
  const clock = projectClock(payload, now);
  const effective = payload.performedSets.map((set) => effectiveSet(set, payload.corrections));
  const loads = effective
    .filter((set) => !set.voided && set.outcome === 'completed' && set.load)
    .map((set) => {
      const exercise = payload.exerciseSessions.find((item) => item.id === set.exerciseSessionId);
      return {
        exerciseName: exercise?.name ?? 'Exercício',
        setIndex: set.setIndex,
        plannedLoad: set.plannedLoad,
        plannedLoadUnit: set.plannedLoadUnit,
        load: set.load,
        loadUnit: set.loadUnit,
      };
    });
  return {
    planName: payload.planName,
    gymName: payload.gymName,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    activeSeconds: payload.endedAt ? clock.activeSeconds : clock.activeSeconds,
    elapsedSeconds: clock.elapsedSeconds,
    completedExercises: payload.exerciseSessions.filter(
      (exercise) => exercise.status === 'completed',
    ).length,
    skippedExercises: payload.exerciseSessions.filter((exercise) => exercise.status === 'skipped')
      .length,
    partialExercises: payload.exerciseSessions.filter(
      (exercise) => exercise.status === 'in_progress',
    ).length,
    plannedSets: payload.planSnapshot.exercises.reduce(
      (total, exercise) => total + exercise.sets.length,
      0,
    ),
    performedSets: effective.filter((set) => !set.voided && set.outcome === 'completed').length,
    skippedSets: effective.filter((set) => !set.voided && set.outcome === 'skipped').length,
    loads,
    feedback: payload.feedback,
  };
}
