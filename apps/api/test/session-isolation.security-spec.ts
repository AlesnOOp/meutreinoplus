import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  canonicalJsonString,
  sessionSyncPayloadSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// Fail before AppModule connects. This suite deliberately leaves evidence in its disposable DB.
function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    !['/mt_recovery01_test', '/mt_recovery01_test_verified'].includes(url.pathname) ||
    process.env.EXPECTED_DATABASE !== url.pathname.slice(1)
  ) {
    throw new Error('Recovery 01 requires its isolated local disposable PostgreSQL on port 55439.');
  }
}

type Fixture = { token: string; userId: string; payload: SessionSyncPayload; version: number };
jest.setTimeout(120_000);

describe('Recovery 01: real PostgreSQL session reference isolation', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let a: Fixture;
  let b: Fixture;
  let previousA: SessionSyncPayload;

  beforeAll(async () => {
    assertDisposableDatabase();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    const identity = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe(process.env.EXPECTED_DATABASE);
    a = await fixture('A');
    await post(
      a.token,
      `/workout-sessions/${a.payload.id}/finish`,
      { confirmIncomplete: true },
      200,
    );
    previousA = a.payload;
    const next = await post(a.token, '/workout-sessions', { planId: a.payload.planId }, 201);
    a.payload = sessionSyncPayloadSchema.parse(next.body.payload);
    const recorded = await post(
      a.token,
      `/workout-sessions/${a.payload.id}/sets`,
      {
        id: randomUUID(),
        exerciseSessionId: a.payload.exerciseSessions[0]!.id,
        repetitions: 8,
        outcome: 'completed',
      },
      200,
    );
    a.payload = sessionSyncPayloadSchema.parse(recorded.body.payload);
    a.version = recorded.body.version as number;
    b = await fixture('B');
  });

  afterAll(async () => {
    await app?.close();
  });

  function server(): App {
    return app.getHttpServer() as App;
  }
  function post(token: string, path: string, body: object, status: number) {
    return request(server())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(status);
  }

  async function fixture(name: string): Promise<Fixture> {
    const email = `recovery01-${randomUUID()}@example.com`;
    const password = 'correct-horse-battery';
    await post(
      '',
      '/auth/register',
      { displayName: name, email, password, acceptTerms: true, acceptPrivacy: true },
      202,
    );
    const login = await post(
      '',
      '/auth/login',
      {
        email,
        password,
        device: {
          installationId: randomUUID(),
          platform: 'ios',
          appVersion: '0.1.0',
          label: 'Recovery 01',
        },
      },
      200,
    );
    const token = login.body.tokens.accessToken as string;
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const exercise = await db.exercise.create({
      data: {
        origin: 'user',
        ownerUserId: user.id,
        namePt: `Exercício ${name}`,
        activityType: 'strength',
      },
    });
    const plan = await post(token, '/workout-plans', { name: `Ficha ${name}` }, 201);
    const added = await post(
      token,
      `/workout-plans/${plan.body.id}/exercises`,
      {
        baseVersion: plan.body.version,
        exerciseId: exercise.id,
      },
      201,
    );
    await post(
      token,
      `/workout-plans/${plan.body.id}/exercises/${added.body.exercises[0].id}/sets`,
      {
        baseVersion: added.body.version,
        repetitions: 8,
        load: null,
        loadUnit: 'kg',
        restSeconds: null,
      },
      201,
    );
    const started = await post(token, '/workout-sessions', { planId: plan.body.id }, 201);
    const payload = sessionSyncPayloadSchema.parse(started.body.payload);
    const recorded = await post(
      token,
      `/workout-sessions/${payload.id}/sets`,
      {
        id: randomUUID(),
        exerciseSessionId: payload.exerciseSessions[0]!.id,
        repetitions: 8,
      },
      200,
    );
    return {
      token,
      userId: user.id,
      payload: sessionSyncPayloadSchema.parse(recorded.body.payload),
      version: recorded.body.version as number,
    };
  }

  function offline(): SessionSyncPayload {
    const payload = structuredClone(a.payload);
    payload.id = randomUUID();
    payload.status = 'completed';
    payload.endedAt = new Date().toISOString();
    const oldExercise = payload.exerciseSessions[0]!;
    oldExercise.id = randomUUID();
    payload.performedSets = [
      { ...payload.performedSets[0]!, id: randomUUID(), exerciseSessionId: oldExercise.id },
    ];
    payload.corrections = [];
    payload.feedback = [];
    payload.timeEvents = [];
    return payload;
  }

  function correction(setId: string) {
    return {
      id: randomUUID(),
      performedSetId: setId,
      repetitions: null,
      load: null,
      loadUnit: null,
      voided: true,
      reason: 'Teste de isolamento',
      createdAt: new Date().toISOString(),
    } as const;
  }
  function event(exerciseSessionId: string | null) {
    return {
      id: randomUUID(),
      kind: 'rest_start',
      exerciseSessionId,
      occurredAt: new Date().toISOString(),
      restDurationSeconds: 30,
    } as const;
  }
  function operation(payload: SessionSyncPayload, baseVersion: number | null = null) {
    const parsed = sessionSyncPayloadSchema.parse(payload);
    return {
      id: randomUUID(),
      entityType: 'workout_session',
      entityId: parsed.id,
      operation: 'upsert',
      idempotencyKey: randomUUID(),
      payloadHash: createHash('sha256').update(canonicalJsonString(parsed)).digest('hex'),
      baseVersion,
      createdAt: new Date().toISOString(),
      payload: parsed,
    };
  }
  async function state() {
    // Full rows, not only counts: detects partial writes, version changes and altered relationships.
    const orderBy = { id: 'asc' as const };
    return JSON.stringify(
      await Promise.all([
        db.workoutSession.findMany({ orderBy }),
        db.exerciseSession.findMany({ orderBy }),
        db.performedSet.findMany({ orderBy }),
        db.performedSetCorrection.findMany({ orderBy }),
        db.exerciseFeedback.findMany({ orderBy }),
        db.sessionTimeEvent.findMany({ orderBy }),
        db.syncOperation.findMany({ orderBy }),
        db.workoutSessionConflict.findMany({ orderBy }),
        db.workoutPlanRevision.findMany({ orderBy }),
      ]),
    );
  }
  async function rejected(payload: SessionSyncPayload, retry = false) {
    const op = operation(payload, payload.id === a.payload.id ? a.version : null);
    const before = await state();
    const response = await post(a.token, '/sync', { operations: [op] }, 400);
    expect(response.body.error.code).toBe('invalid_session_references');
    expect(JSON.stringify(response.body)).not.toContain(b.userId);
    expect(await state()).toBe(before);
    if (retry) {
      await post(a.token, '/sync', { operations: [op] }, 400);
      expect(await state()).toBe(before);
    }
    expect(
      await db.syncOperation.count({
        where: { idempotencyKey: op.idempotencyKey, status: 'applied' },
      }),
    ).toBe(0);
  }

  it('1 + 9: rejects correction of B and repeated invalid operation without partial writes', async () => {
    const p = offline();
    p.corrections = [correction(b.payload.performedSets[0]!.id)];
    await rejected(p, true);
  });
  it('2: rejects a performed set pointing at B exercise session', async () => {
    const p = offline();
    p.performedSets[0]!.exerciseSessionId = b.payload.exerciseSessions[0]!.id;
    p.performedSets[0]!.setIndex = 2;
    await rejected(p);
  });
  it('3: rejects feedback pointing at B exercise session', async () => {
    const p = offline();
    p.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: b.payload.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 3,
        comment: null,
      },
    ];
    await rejected(p);
  });
  it('4: rejects using B session', async () => {
    await rejected(structuredClone(b.payload));
  });
  it('5: rejects using B plan revision', async () => {
    const p = offline();
    p.planId = b.payload.planId;
    p.planVersion = b.payload.planVersion;
    p.planSnapshot = b.payload.planSnapshot;
    await rejected(p);
  });
  it('6: rejects an event associated with B exercise/session', async () => {
    const p = offline();
    p.timeEvents = [event(b.payload.exerciseSessions[0]!.id)];
    await rejected(p);
  });
  it('7: rejects a correction targeting another session of A', async () => {
    const p = offline();
    p.corrections = [correction(previousA.performedSets[0]!.id)];
    await rejected(p);
  });
  it('8: rejects mixed legitimate records and one invalid reference atomically', async () => {
    const p = offline();
    p.corrections = [correction(p.performedSets[0]!.id)];
    p.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: p.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 4,
        comment: 'legítimo',
      },
    ];
    p.timeEvents = [event(p.exerciseSessions[0]!.id), event(b.payload.exerciseSessions[0]!.id)];
    await rejected(p);
  });
  it.each(['correction', 'set', 'feedback', 'event', 'exercise', 'plan'] as const)(
    'rejects forged %s references on merge too',
    async (kind) => {
      const p = structuredClone(a.payload);
      if (kind === 'correction') p.corrections = [correction(b.payload.performedSets[0]!.id)];
      if (kind === 'set')
        p.performedSets.push({
          ...p.performedSets[0]!,
          id: randomUUID(),
          setIndex: 2,
          exerciseSessionId: b.payload.exerciseSessions[0]!.id,
        });
      if (kind === 'feedback')
        p.feedback = [
          {
            id: randomUUID(),
            exerciseSessionId: b.payload.exerciseSessions[0]!.id,
            version: 0,
            perceivedLevel: 3,
            comment: null,
          },
        ];
      if (kind === 'event') p.timeEvents = [event(b.payload.exerciseSessions[0]!.id)];
      if (kind === 'exercise')
        p.exerciseSessions[0]!.exerciseId = b.payload.exerciseSessions[0]!.exerciseId;
      if (kind === 'plan') p.planId = b.payload.planId;
      await rejected(p);
    },
  );
  it('rejects IDs transplanted between records created in the payload', async () => {
    const p = offline();
    p.corrections = [correction(randomUUID())];
    await rejected(p);
    const q = offline();
    q.performedSets[0]!.plannedSetId = b.payload.planSnapshot.exercises[0]!.sets[0]!.id;
    await rejected(q);
  });
  it('rejects existing child IDs belonging to a different aggregate', async () => {
    const p = offline();
    p.exerciseSessions[0]!.id = b.payload.exerciseSessions[0]!.id;
    p.performedSets[0]!.exerciseSessionId = p.exerciseSessions[0]!.id;
    await rejected(p);
  });
  it('protects individual REST writes, including rest events', async () => {
    const root = `/workout-sessions/${a.payload.id}`;
    const attacks: Array<[string, object]> = [
      [`${root}/sets/${b.payload.performedSets[0]!.id}/correct`, { voided: true, reason: 'Teste' }],
      [
        `${root}/sets`,
        { id: randomUUID(), exerciseSessionId: b.payload.exerciseSessions[0]!.id, repetitions: 5 },
      ],
      [`${root}/exercises/${b.payload.exerciseSessions[0]!.id}/feedback`, { perceivedLevel: 4 }],
      [
        `${root}/rest`,
        {
          action: 'start',
          durationSeconds: 30,
          exerciseSessionId: b.payload.exerciseSessions[0]!.id,
        },
      ],
      [`${root}/sets/${previousA.performedSets[0]!.id}/correct`, { voided: true, reason: 'Teste' }],
    ];
    for (const [path, body] of attacks) {
      const before = await state();
      const response = await request(server())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${a.token}`)
        .send(body);
      expect([400, 404]).toContain(response.status);
      expect(await state()).toBe(before);
    }
  });
  it('validates references even when REST start reuses an existing session ID', async () => {
    const before = await state();
    await post(a.token, '/workout-sessions', { id: a.payload.id, planId: b.payload.planId }, 400);
    await post(
      a.token,
      '/workout-sessions',
      {
        id: a.payload.id,
        planId: a.payload.planId,
        exerciseSessions: [
          {
            id: b.payload.exerciseSessions[0]!.id,
            planExerciseId: a.payload.exerciseSessions[0]!.planExerciseId,
          },
        ],
      },
      400,
    );
    expect(await state()).toBe(before);
    await post(a.token, '/workout-sessions', { id: a.payload.id, planId: a.payload.planId }, 201);
    expect(await state()).toBe(before);
  });

  it.each(['set', 'feedback', 'event'] as const)(
    'rejects %s references to another session of the same user',
    async (kind) => {
      const p = offline();
      const other = previousA.exerciseSessions[0]!.id;
      if (kind === 'set') p.performedSets[0]!.exerciseSessionId = other;
      if (kind === 'feedback')
        p.feedback = [
          {
            id: randomUUID(),
            exerciseSessionId: other,
            version: 0,
            perceivedLevel: 3,
            comment: null,
          },
        ];
      if (kind === 'event') p.timeEvents = [event(other)];
      await rejected(p);
    },
  );

  it('rejects foreign IDs disguised as records created in this payload', async () => {
    const p = offline();
    p.performedSets[0]!.id = b.payload.performedSets[0]!.id;
    p.corrections = [correction(p.performedSets[0]!.id)];
    await rejected(p);
    const q = offline();
    q.planSnapshot.exercises[0]!.exerciseId = b.payload.exerciseSessions[0]!.exerciseId;
    await rejected(q);
    const duplicate = offline();
    duplicate.performedSets.push({ ...duplicate.performedSets[0]!, setIndex: 2 });
    await rejected(duplicate);
  });

  it.each(['keep_local', 'keep_both'] as const)(
    'revalidates legacy conflict references for %s before corrections',
    async (choice) => {
      const forged = structuredClone(a.payload);
      forged.corrections = [correction(b.payload.performedSets[0]!.id)];
      const conflict = await db.workoutSessionConflict.create({
        data: {
          id: randomUUID(),
          userId: a.userId,
          workoutSessionId: a.payload.id,
          baseVersion: a.version,
          payload: JSON.parse(JSON.stringify(forged)) as Prisma.InputJsonValue,
        },
      });
      const before = await state();
      await post(a.token, `/workout-session-conflicts/${conflict.id}/resolve`, { choice }, 400);
      expect(await state()).toBe(before);
    },
  );

  it('does not accept a legacy success receipt for an invalid payload', async () => {
    const p = offline();
    p.corrections = [correction(b.payload.performedSets[0]!.id)];
    const op = operation(p);
    const device = await db.device.findFirstOrThrow({ where: { userId: a.userId } });
    // Represents a receipt produced before this fix: it must not bypass authorization.
    await db.syncOperation.create({
      data: {
        id: op.id,
        idempotencyKey: op.idempotencyKey,
        payloadHash: op.payloadHash,
        userId: a.userId,
        deviceId: device.id,
        entityType: 'workout_session',
        entityId: p.id,
        operation: 'upsert',
        status: 'applied',
      },
    });
    const before = await state();
    const response = await post(a.token, '/sync', { operations: [op] }, 400);
    expect(response.body.error.code).toBe('invalid_session_references');
    expect(await state()).toBe(before);
  });

  it('preserves idempotency under concurrent legitimate retries', async () => {
    const p = offline();
    const op = operation(p);
    const replies = await Promise.all(
      [1, 2].map(() => post(a.token, '/sync', { operations: [op] }, 201)),
    );
    expect(replies.map((reply) => reply.body.results[0].status)).toEqual(['applied', 'applied']);
    expect(await db.syncOperation.count({ where: { idempotencyKey: op.idempotencyKey } })).toBe(1);
    expect(await db.performedSet.count({ where: { id: p.performedSets[0]!.id } })).toBe(1);
  });

  it('preserves REST correction, feedback, rest, history and append-only guards', async () => {
    const root = `/workout-sessions/${a.payload.id}`;
    const setId = a.payload.performedSets[0]!.id;
    await post(
      a.token,
      `${root}/sets/${setId}/correct`,
      { repetitions: 9, reason: 'Correção legítima' },
      200,
    );
    await post(
      a.token,
      `${root}/exercises/${a.payload.exerciseSessions[0]!.id}/feedback`,
      { perceivedLevel: 4, comment: 'Legítimo' },
      200,
    );
    const saved = await post(
      a.token,
      `${root}/rest`,
      {
        action: 'start',
        durationSeconds: 30,
        exerciseSessionId: a.payload.exerciseSessions[0]!.id,
      },
      200,
    );
    a.payload = sessionSyncPayloadSchema.parse(saved.body.payload);
    a.version = saved.body.version as number;
    const before = await state();
    await expect(
      db.$executeRaw`UPDATE meutreino.performed_sets SET notes = 'forbidden' WHERE id = ${setId}::uuid`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`DELETE FROM meutreino.performed_sets WHERE id = ${setId}::uuid`,
    ).rejects.toThrow();
    expect(await state()).toBe(before);
    const history = await request(server())
      .get('/api/v1/workout-sessions')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(history.body.items.some((item: { id: string }) => item.id === a.payload.id)).toBe(true);
  });

  it('10: applies legitimate offline references once and rejects poisoned/cross-user retries', async () => {
    const p = offline();
    p.corrections = [correction(p.performedSets[0]!.id)];
    p.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: p.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 3,
        comment: 'Seguro',
      },
    ];
    p.timeEvents = [event(p.exerciseSessions[0]!.id)];
    const op = operation(p);
    const applied = await post(a.token, '/sync', { operations: [op] }, 201);
    expect(applied.body.results[0].status).toBe('applied');
    const before = await state();
    const retry = await post(a.token, '/sync', { operations: [op] }, 201);
    expect(retry.body.results[0].status).toBe('applied');
    expect(await state()).toBe(before);
    expect(await db.performedSet.count({ where: { id: p.performedSets[0]!.id } })).toBe(1);
    expect(await db.performedSetCorrection.count({ where: { id: p.corrections[0]!.id } })).toBe(1);
    const fetched = await request(server())
      .get(`/api/v1/workout-sessions/${p.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);
    expect(fetched.body.payload.planSnapshot).toEqual(p.planSnapshot);
    expect(fetched.body.payload.planVersion).toBe(p.planVersion);
    expect(fetched.body.payload.feedback).toHaveLength(1);
    const poisoned = operation({ ...p, corrections: [correction(b.payload.performedSets[0]!.id)] });
    poisoned.idempotencyKey = op.idempotencyKey;
    const bad = await request(server())
      .post('/api/v1/sync')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ operations: [poisoned] });
    expect(bad.status === 400 || bad.body.results?.[0]?.status === 'rejected').toBe(true);
    const cross = await request(server())
      .post('/api/v1/sync')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ operations: [op] });
    expect(cross.status === 400 || cross.body.results?.[0]?.status === 'rejected').toBe(true);
    expect(await state()).toBe(before);
  });
});
