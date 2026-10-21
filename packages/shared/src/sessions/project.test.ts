import { describe, expect, it } from 'vitest';
import { planSchema } from '../plans/contracts';
import type { SessionSyncPayload } from './contracts';
import {
  effectiveSet,
  hasUnfinishedPlannedSets,
  mergePerformedSets,
  performedSetFingerprint,
  projectClock,
  projectRest,
} from './project';

const now = '2026-10-20T12:02:00.000Z';

function payload(overrides: Partial<SessionSyncPayload> = {}): SessionSyncPayload {
  const snapshot = planSchema.parse({
    id: '10000000-0000-4000-8000-000000000101',
    name: 'Treino A',
    description: null,
    accent: null,
    status: 'active',
    version: 1,
    duplicatedFromId: null,
    createdAt: '2026-10-20T11:00:00.000Z',
    updatedAt: '2026-10-20T11:00:00.000Z',
    archivedAt: null,
    exercises: [
      {
        id: '10000000-0000-4000-8000-000000000102',
        exerciseId: '10000000-0000-4000-8000-000000000001',
        exerciseName: 'Agachamento',
        orderIndex: 1,
        restSeconds: 90,
        notes: null,
        equipment: [],
        sets: [
          {
            id: '10000000-0000-4000-8000-000000000103',
            setIndex: 1,
            kind: 'normal',
            repetitions: 8,
            load: '40.00',
            loadUnit: 'kg',
            loadType: 'fixed',
            restSeconds: 90,
            notes: null,
          },
        ],
      },
    ],
  });
  return {
    id: '10000000-0000-4000-8000-000000000201',
    planId: snapshot.id,
    planVersion: 1,
    planName: snapshot.name,
    gymId: null,
    gymName: null,
    status: 'in_progress',
    startedAt: '2026-10-20T12:00:00.000Z',
    endedAt: null,
    notes: null,
    planSnapshot: snapshot,
    exerciseSessions: [
      {
        id: '10000000-0000-4000-8000-000000000202',
        planExerciseId: snapshot.exercises[0]!.id,
        exerciseId: snapshot.exercises[0]!.exerciseId,
        name: 'Agachamento',
        orderIndex: 1,
        status: 'pending',
        skipReason: null,
        gymName: null,
        equipmentName: null,
        machineNumber: null,
        restSeconds: 90,
      },
    ],
    performedSets: [],
    corrections: [],
    feedback: [],
    timeEvents: [],
    ...overrides,
  };
}

describe('session projection', () => {
  it('keeps the workout clock after a gap that represents background time', () => {
    const clock = projectClock(
      payload({
        timeEvents: [
          {
            id: '10000000-0000-4000-8000-000000000301',
            kind: 'pause',
            occurredAt: '2026-10-20T12:00:20.000Z',
            restDurationSeconds: null,
            exerciseSessionId: null,
          },
          {
            id: '10000000-0000-4000-8000-000000000302',
            kind: 'resume',
            occurredAt: '2026-10-20T12:01:00.000Z',
            restDurationSeconds: null,
            exerciseSessionId: null,
          },
        ],
      }),
      now,
    );
    expect(clock.activeSeconds).toBe(80);
    expect(clock.elapsedSeconds).toBe(120);
  });

  it('recovers the rest countdown from the start timestamp', () => {
    const rest = projectRest(
      [
        {
          id: '10000000-0000-4000-8000-000000000303',
          kind: 'rest_start',
          occurredAt: '2026-10-20T12:00:30.000Z',
          restDurationSeconds: 90,
          exerciseSessionId: null,
        },
      ],
      now,
    );
    expect(rest).toBeNull();
  });

  it('shows the remaining rest when the app returns before it ends', () => {
    const rest = projectRest(
      [
        {
          id: '10000000-0000-4000-8000-000000000304',
          kind: 'rest_start',
          occurredAt: '2026-10-20T12:01:00.000Z',
          restDurationSeconds: 90,
          exerciseSessionId: null,
        },
      ],
      now,
    );
    expect(rest).toEqual({
      remainingSeconds: 30,
      running: true,
      paused: false,
      durationSeconds: 90,
      exerciseSessionId: null,
    });
  });

  it('keeps the original set and applies the latest correction', () => {
    const set = {
      id: '10000000-0000-4000-8000-000000000401',
      exerciseSessionId: '10000000-0000-4000-8000-000000000202',
      plannedSetId: '10000000-0000-4000-8000-000000000103',
      setIndex: 1,
      plannedRepetitions: 8,
      plannedLoad: '40.00',
      plannedLoadUnit: 'kg' as const,
      repetitions: 8,
      load: '40.00',
      loadUnit: 'kg' as const,
      outcome: 'completed' as const,
      completedAt: now,
      notes: null,
    };
    const corrected = effectiveSet(set, [
      {
        id: '10000000-0000-4000-8000-000000000402',
        performedSetId: set.id,
        repetitions: 6,
        load: '42.50',
        loadUnit: 'kg',
        voided: false,
        reason: 'Ajuste',
        createdAt: '2026-10-20T12:03:00.000Z',
      },
    ]);
    expect(set.repetitions).toBe(8);
    expect(set.load).toBe('40.00');
    expect(corrected.repetitions).toBe(6);
    expect(corrected.load).toBe('42.50');
    expect(corrected.plannedLoad).toBe('40.00');
  });

  it('does not replace a divergent performed set and accepts a new one', () => {
    const server = [
      {
        id: 'a',
        fingerprint: performedSetFingerprint({
          outcome: 'completed',
          repetitions: 8,
          load: '40.00',
          loadUnit: 'kg',
          notes: null,
        }),
      },
    ];
    const client = [
      {
        id: 'a',
        fingerprint: performedSetFingerprint({
          outcome: 'completed',
          repetitions: 5,
          load: '40.00',
          loadUnit: 'kg',
          notes: null,
        }),
      },
      { id: 'b', fingerprint: 'extra' },
    ];
    const merged = mergePerformedSets(server, client);
    expect(merged.accepted.map((item) => item.id)).toEqual(['b']);
    expect(merged.divergent).toHaveLength(1);
    expect(server[0]?.fingerprint).toContain('8');
  });

  it('asks for confirmation while a planned set has no completed result', () => {
    expect(hasUnfinishedPlannedSets(payload())).toBe(true);
  });
});
