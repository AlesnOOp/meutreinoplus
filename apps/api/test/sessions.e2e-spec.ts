import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonString, sessionSyncPayloadSchema } from '@meutreino/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DeletionService } from '../src/identity/deletion.service';
import { PrismaService } from '../src/prisma/prisma.service';

const SQUAT = '10000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);

describe('Workout sessions API', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let deletion: DeletionService;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    deletion = app.get(DeletionService);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await deletion.purge(userId).catch(() => undefined);
    }
    await app?.close();
  });

  it('keeps existing rows and stores sessions only in meutreino', async () => {
    const rows = await prisma.$queryRaw<
      { users: number; exercises: number; public_sessions: boolean }[]
    >`
      SELECT
        (SELECT count(*)::int FROM meutreino.users) AS users,
        (SELECT count(*)::int FROM meutreino.exercises) AS exercises,
        EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'workout_sessions'
        ) AS public_sessions`;
    expect(rows[0]?.users).toBeGreaterThanOrEqual(57);
    expect(rows[0]?.exercises).toBeGreaterThanOrEqual(12);
    expect(rows[0]?.public_sessions).toBe(false);
  });

  it('freezes the plan revision and records the performed workout', async () => {
    const owner = await signIn('Treino');
    const other = await signIn('Outro');
    const gym = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Academia Centro' })
      .expect(201);
    const plan = await createPlan(owner.token, 'Treino A');
    const withExercise = await addExercise(owner.token, plan, SQUAT, 90);
    const exercise = withExercise.exercises[0];
    expect(exercise).toBeDefined();
    const withSetResponse = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${exercise!.id}/sets`)
      .set(bearer(owner.token))
      .send({
        baseVersion: withExercise.version,
        repetitions: 8,
        load: '40',
        loadUnit: 'kg',
        restSeconds: 90,
      })
      .expect(201);
    const withSet = withSetResponse.body as {
      version: number;
      exercises: Array<{ sets: Array<{ id: string }> }>;
    };
    const plannedSet = withSet.exercises[0]?.sets[0];
    expect(plannedSet?.id).toBeDefined();
    const withSecondSet = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${exercise!.id}/sets`)
      .set(bearer(owner.token))
      .send({ baseVersion: withSet.version, repetitions: 12, loadUnit: 'kg', restSeconds: null })
      .expect(201);
    const planVersion = (withSecondSet.body as { version: number }).version;
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const sessionId = randomUUID();
    const started = await request(server())
      .post('/api/v1/workout-sessions')
      .set(bearer(owner.token))
      .send({ id: sessionId, planId: plan.id, gymId: gym.body.id, startedAt })
      .expect(201);
    expect(started.body.payload.planVersion).toBe(planVersion);
    expect(started.body.payload.planSnapshot.name).toBe('Treino A');
    expect(started.body.payload.gymName).toBe('Academia Centro');
    const exerciseSessionId = started.body.payload.exerciseSessions[0].id as string;
    await request(server())
      .patch(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .send({ name: 'Treino B', description: null, accent: 'green', baseVersion: planVersion })
      .expect(200);
    const afterEdit = await request(server())
      .get(`/api/v1/workout-sessions/${sessionId}`)
      .set(bearer(owner.token))
      .expect(200);
    expect(afterEdit.body.payload.planSnapshot.name).toBe('Treino A');
    expect(afterEdit.body.payload.planVersion).toBe(planVersion);
    await expect(
      prisma.workoutSession.update({
        where: { id: sessionId },
        data: { planNameSnapshot: 'Alterada' },
      }),
    ).rejects.toThrow(/photograph is immutable/);
    const setId = randomUUID();
    const recorded = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets`)
      .set(bearer(owner.token))
      .send({
        id: setId,
        exerciseSessionId,
        plannedSetId: plannedSet!.id,
        repetitions: 6,
        load: '42.5',
        loadUnit: 'kg',
        outcome: 'completed',
      })
      .expect(200);
    expect(recorded.body.payload.performedSets[0].plannedLoad).toBe('40.00');
    expect(recorded.body.payload.performedSets[0].load).toBe('42.50');
    const replay = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets`)
      .set(bearer(owner.token))
      .send({
        id: setId,
        exerciseSessionId,
        plannedSetId: plannedSet!.id,
        repetitions: 6,
        load: '42.5',
        loadUnit: 'kg',
        outcome: 'completed',
      })
      .expect(200);
    expect(replay.body.payload.performedSets).toHaveLength(1);
    const corrected = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets/${setId}/correct`)
      .set(bearer(owner.token))
      .send({ repetitions: 5, load: '45', loadUnit: 'kg', reason: 'Ajuste do aluno' })
      .expect(200);
    expect(corrected.body.payload.performedSets[0].load).toBe('42.50');
    expect(corrected.body.payload.corrections[0].load).toBe('45.00');
    const original = await prisma.performedSet.findUniqueOrThrow({ where: { id: setId } });
    expect(original.performedRepetitions).toBe(6);
    await expect(
      prisma.performedSet.update({ where: { id: setId }, data: { performedRepetitions: 1 } }),
    ).rejects.toThrow(/append-only/);
    const extraId = randomUUID();
    const extra = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets`)
      .set(bearer(owner.token))
      .send({
        id: extraId,
        exerciseSessionId,
        repetitions: 4,
        load: null,
        outcome: 'completed',
      })
      .expect(200);
    expect(
      extra.body.payload.performedSets.find((set: { id: string }) => set.id === extraId)
        .plannedSetId,
    ).toBeNull();
    const skippedId = randomUUID();
    await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets`)
      .set(bearer(owner.token))
      .send({ id: skippedId, exerciseSessionId, outcome: 'skipped' })
      .expect(200);
    await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/sets/${skippedId}/undo`)
      .set(bearer(owner.token))
      .send({ reason: 'Marcação desfeita pelo aluno.' })
      .expect(200);
    await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/exercises/${exerciseSessionId}/feedback`)
      .set(bearer(owner.token))
      .send({ perceivedLevel: 4, comment: 'Bom controle' })
      .expect(200);
    const pausedAt = new Date(Date.now() - 90_000).toISOString();
    const resumedAt = new Date(Date.now() - 60_000).toISOString();
    await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/pause`)
      .set(bearer(owner.token))
      .send({ occurredAt: pausedAt })
      .expect(200);
    const resumed = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/resume`)
      .set(bearer(owner.token))
      .send({ occurredAt: resumedAt })
      .expect(200);
    expect(resumed.body.payload.status).toBe('in_progress');
    const rest = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/rest`)
      .set(bearer(owner.token))
      .send({
        action: 'start',
        durationSeconds: 90,
        exerciseSessionId,
        occurredAt: new Date(Date.now() - 50_000).toISOString(),
      })
      .expect(200);
    expect(rest.body.rest.remainingSeconds).toBeGreaterThanOrEqual(30);
    expect(rest.body.rest.remainingSeconds).toBeLessThanOrEqual(45);
    await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/finish`)
      .set(bearer(owner.token))
      .send({ confirmIncomplete: false })
      .expect(409);
    const finished = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/finish`)
      .set(bearer(owner.token))
      .send({ confirmIncomplete: true, notes: 'Treino concluído' })
      .expect(200);
    expect(finished.body.payload.status).toBe('completed');
    expect(finished.body.lockedAt).toBeTruthy();
    expect(finished.body.elapsedSeconds - finished.body.activeSeconds).toBeGreaterThanOrEqual(25);
    expect(finished.body.elapsedSeconds - finished.body.activeSeconds).toBeLessThanOrEqual(40);
    const duplicateFinish = await request(server())
      .post(`/api/v1/workout-sessions/${sessionId}/finish`)
      .set(bearer(owner.token))
      .send({ confirmIncomplete: true })
      .expect(409);
    expect(duplicateFinish.body.error.code).toBe('session_locked');
    const summary = await request(server())
      .get(`/api/v1/workout-sessions/${sessionId}/summary`)
      .set(bearer(owner.token))
      .expect(200);
    expect(summary.body.summary.planName).toBe('Treino A');
    expect(summary.body.summary.performedSets).toBeGreaterThanOrEqual(2);
    expect(summary.body.summary.feedback[0].perceivedLevel).toBe(4);
    await request(server())
      .post('/api/v1/workout-sessions')
      .set(bearer(owner.token))
      .send({ planId: plan.id })
      .expect(201);
    await request(server())
      .get(`/api/v1/workout-sessions/${sessionId}`)
      .set(bearer(other.token))
      .expect(404);
    const sets = await prisma.performedSet.count({ where: { id: setId } });
    expect(sets).toBe(1);
  });

  it('syncs an offline session without duplicating or dropping performed sets', async () => {
    const owner = await signIn('Offline');
    const plan = await createPlan(owner.token, 'Treino C');
    const withExercise = await addExercise(owner.token, plan, SQUAT, null);
    const exercise = withExercise.exercises[0]!;
    const remote = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .expect(200);
    const sessionId = randomUUID();
    const exerciseSessionId = randomUUID();
    const setId = randomUUID();
    const payload = sessionSyncPayloadSchema.parse({
      id: sessionId,
      planId: plan.id,
      planVersion: remote.body.version,
      planName: remote.body.name,
      gymId: null,
      gymName: null,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      endedAt: null,
      notes: null,
      planSnapshot: remote.body,
      exerciseSessions: [
        {
          id: exerciseSessionId,
          planExerciseId: exercise.id,
          exerciseId: exercise.exerciseId,
          name: 'Agachamento',
          orderIndex: 1,
          status: 'in_progress',
          skipReason: null,
          gymName: null,
          equipmentName: null,
          machineNumber: null,
          restSeconds: null,
        },
      ],
      performedSets: [
        {
          id: setId,
          exerciseSessionId,
          plannedSetId: null,
          setIndex: 1,
          plannedRepetitions: null,
          plannedLoad: null,
          plannedLoadUnit: null,
          repetitions: 10,
          load: '20.00',
          loadUnit: 'kg',
          outcome: 'completed',
          completedAt: new Date().toISOString(),
          notes: null,
        },
      ],
      corrections: [],
      feedback: [],
      timeEvents: [],
    });
    const operation = syncOperation(payload, null);
    const applied = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(applied.body.results[0].status).toBe('applied');
    const retry = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(retry.body.results[0].status).toBe('applied');
    expect(await prisma.performedSet.count({ where: { id: setId } })).toBe(1);
    const divergent = syncOperation(
      {
        ...payload,
        performedSets: [{ ...payload.performedSets[0]!, repetitions: 3 }],
      },
      1,
    );
    const conflict = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [divergent] })
      .expect(201);
    expect(conflict.body.results[0].status).toBe('conflict');
    expect(conflict.body.results[0].code).toBe('performed_set_diverged');
    const kept = await prisma.performedSet.findUniqueOrThrow({ where: { id: setId } });
    expect(kept.performedRepetitions).toBe(10);
    const local = sessionSyncPayloadSchema.parse(divergent.payload);
    const reviewed = await request(server())
      .post(`/api/v1/workout-session-conflicts/${divergent.id}/preview`)
      .set(bearer(owner.token))
      .send({ choice: 'keep_local', localRevision: 1, payload: local })
      .expect(200);
    await request(server())
      .post(`/api/v1/workout-session-conflicts/${divergent.id}/resolve`)
      .set(bearer(owner.token))
      .send({
        choice: 'keep_local',
        payload: local,
        localRevision: 1,
        expectedVersion: reviewed.body.remoteVersion as number,
        previewHash: reviewed.body.previewHash as string,
        idempotencyKey: randomUUID(),
        confirmDiscard: false,
      })
      .expect(200);
    const after = await prisma.performedSet.findUniqueOrThrow({ where: { id: setId } });
    expect(after.performedRepetitions).toBe(10);
    expect(await prisma.performedSetCorrection.count({ where: { performedSetId: setId } })).toBe(1);
    const revision = await prisma.workoutPlanRevision.findUniqueOrThrow({
      where: { planId_version: { planId: plan.id, version: remote.body.version } },
    });
    expect(JSON.stringify(revision.snapshot)).toContain('Treino C');
  });

  async function signIn(name: string): Promise<{ token: string; userId: string }> {
    const email = `sessions-${randomUUID()}@example.com`;
    const password = 'correct-horse-battery';
    await request(server())
      .post('/api/v1/auth/register')
      .send({ displayName: name, email, password, acceptTerms: true, acceptPrivacy: true })
      .expect(202);
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
        device: {
          installationId: randomUUID(),
          platform: 'ios',
          appVersion: '0.1.0',
          label: 'teste',
        },
      })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    return { token: login.body.tokens.accessToken as string, userId: user.id };
  }

  async function createPlan(token: string, name: string) {
    const response = await request(server())
      .post('/api/v1/workout-plans')
      .set(bearer(token))
      .send({ name })
      .expect(201);
    return response.body as { id: string; version: number };
  }

  async function addExercise(
    token: string,
    plan: { id: string; version: number },
    exerciseId: string,
    restSeconds: number | null,
  ) {
    const response = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises`)
      .set(bearer(token))
      .send({ baseVersion: plan.version, exerciseId, restSeconds })
      .expect(201);
    return response.body as {
      version: number;
      exercises: Array<{ id: string; exerciseId: string; sets: Array<{ id: string }> }>;
    };
  }

  function server(): App {
    return app.getHttpServer() as App;
  }
});

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function syncOperation(
  payload: ReturnType<typeof sessionSyncPayloadSchema.parse>,
  baseVersion: number | null,
) {
  const value = JSON.parse(JSON.stringify(payload)) as { id: string };
  return {
    id: randomUUID(),
    entityType: 'workout_session' as const,
    entityId: value.id,
    operation: 'upsert' as const,
    idempotencyKey: randomUUID(),
    payloadHash: createHash('sha256').update(canonicalJsonString(value)).digest('hex'),
    baseVersion,
    createdAt: new Date().toISOString(),
    payload: value,
  };
}
