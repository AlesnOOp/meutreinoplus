import { describe, expect, it } from 'vitest';
import { planSchema } from '../plans/contracts';
import type { SessionSyncPayload } from './contracts';
import { rebaseSessionEdits, sessionTimelineError, sessionDifferences } from './resolution';
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

describe('resolution policy', () => {
  it('rebases only post-decision notes while preserving a different remote field', () => {
    const base = payload();
    const latest = payload({ notes: 'Depois' });
    const remote = payload({ gymName: 'Remoto' });
    const result = rebaseSessionEdits(base, latest, remote);
    expect(result?.notes).toBe('Depois');
    expect(result?.gymName).toBe('Remoto');
    expect(base.notes).toBeNull();
  });
  it('does not reopen or edit finalized canonical results', () => {
    const base = payload();
    expect(
      rebaseSessionEdits(
        base,
        payload({ notes: 'Depois' }),
        payload({ status: 'completed', endedAt: '2026-10-20T12:02:00.000Z' }),
      ),
    ).toBeNull();
  });
  it('refuses orphaned newer corrections rather than dropping them', () => {
    const base = payload();
    const latest = payload({
      corrections: [
        {
          id: '10000000-0000-4000-8000-000000000999',
          performedSetId: '10000000-0000-4000-8000-000000000998',
          repetitions: 8,
          load: null,
          loadUnit: null,
          voided: false,
          reason: 'Depois',
          createdAt: '2026-10-20T12:02:00.000Z',
        },
      ],
    });
    expect(rebaseSessionEdits(base, latest, payload())).toBeNull();
  });
  it('lists notes and exercise skip reasons in the discard preview', () => {
    const base = payload();
    const local = payload({ notes: 'Motivo local' });
    local.exerciseSessions[0]!.status = 'skipped';
    local.exerciseSessions[0]!.skipReason = 'Dor';
    const text = sessionDifferences(base, local).join(' ');
    expect(text).toContain('Motivo local');
    expect(text).toContain('Dor');
  });
  it.each(['resume', 'rest_pause', 'rest_resume', 'rest_finish'] as const)(
    'blocks unpaired %s events',
    (kind) => {
      expect(
        sessionTimelineError(
          payload({
            timeEvents: [
              {
                id: '10000000-0000-4000-8000-000000000999',
                kind,
                occurredAt: '2026-10-20T12:01:00.000Z',
                exerciseSessionId: null,
                restDurationSeconds: null,
              },
            ],
          }),
        ),
      ).not.toBeNull();
    },
  );
  it('accepts a new rest after the preceding timer expires naturally', () => {
    const event = {
      id: '10000000-0000-4000-8000-000000000990',
      kind: 'rest_start' as const,
      occurredAt: '2026-10-20T12:00:10.000Z',
      exerciseSessionId: null,
      restDurationSeconds: 10,
    };
    expect(
      sessionTimelineError(
        payload({
          timeEvents: [
            event,
            {
              ...event,
              id: '10000000-0000-4000-8000-000000000991',
              occurredAt: '2026-10-20T12:00:30.000Z',
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      sessionTimelineError(
        payload({
          timeEvents: [
            event,
            {
              ...event,
              id: '10000000-0000-4000-8000-000000000991',
              occurredAt: '2026-10-20T12:00:15.000Z',
            },
          ],
        }),
      ),
    ).not.toBeNull();
  });
  it('maps newer feedback to its canonical exercise identity and expected version', () => {
    const base = payload({
      feedback: [
        {
          id: '10000000-0000-4000-8000-000000000990',
          exerciseSessionId: payload().exerciseSessions[0]!.id,
          perceivedLevel: 3,
          comment: 'Antes',
          version: 0,
        },
      ],
    });
    const latest = structuredClone(base);
    latest.feedback[0]!.comment = 'Depois';
    const remote = payload({
      feedback: [
        {
          ...base.feedback[0]!,
          id: '10000000-0000-4000-8000-000000000991',
          version: 4,
          comment: 'Sincronizado',
        },
      ],
    });
    const rebased = rebaseSessionEdits(base, latest, remote)!;
    expect(rebased.feedback).toHaveLength(1);
    expect(rebased.feedback[0]).toMatchObject({
      id: remote.feedback[0]!.id,
      version: 4,
      comment: 'Depois',
    });
  });
});
