import { DeletionService } from '../src/identity/deletion.service';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  canonicalJsonString,
  planSyncPayloadSchema,
  type PlanSyncPayload,
  planSyncMutationSchema,
  sessionSyncPayloadSchema,
  type SessionSyncPayload,
} from '@meutreino/shared';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

type MobileHarness = {
  user: string;
  close(): Promise<void>;
  reopen(): Promise<void>;
  errors: { ApiClientError: new (message: string, status: number, code: string) => Error };
  api: {
    pushCatalogSync: (ops: unknown[]) => Promise<unknown>;
    pushSessionSync: (ops: unknown[]) => Promise<unknown>;
    listPlansRequest: (page: number) => Promise<unknown>;
    getSessionRequest: (id: string) => Promise<unknown>;
    openSessionRequest: () => Promise<unknown>;
  };
  load(name: string): {
    createLocalPlan(
      user: string,
      input: { name: string; description: null; accent: null },
    ): Promise<{ id: string }>;
    updateLocalPlan(
      user: string,
      id: string,
      change: (draft: PlanSyncPayload) => void,
    ): Promise<unknown>;
  };
  store: {
    startLocalSession(
      user: string,
      id: string,
      gym: null,
      online: boolean,
    ): Promise<SessionSyncPayload>;
    recordLocalSet(
      user: string,
      id: string,
      input: {
        exerciseSessionId: string;
        plannedSetId: string;
        repetitions: number;
        load: null;
        loadUnit: null;
        outcome: 'completed';
      },
    ): Promise<unknown>;
    syncSessions(user: string): Promise<{ synced: boolean }>;
    readLocalSession(user: string, id: string): Promise<SessionSyncPayload & { pending: boolean }>;
  };
};
type Fixture = {
  token: string;
  email: string;
  password: string;
  userId: string;
  payload: SessionSyncPayload;
  version: number;
};
jest.setTimeout(120000);
function guard() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55439' ||
    url.pathname !== '/mt_recovery01_test_verified' ||
    process.env.EXPECTED_DATABASE !== url.pathname.slice(1)
  )
    throw new Error('Requires the isolated Recovery PostgreSQL; refusing other databases.');
}
describe('Recovery 04 transaction, terminal state and offline origin invariants', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  async function startApp() {
    guard();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    expect(
      (await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0]!.name,
    ).toBe(process.env.EXPECTED_DATABASE);
  }
  beforeAll(startApp);
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
    const email = `recovery03-${randomUUID()}@example.com`;
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
      email,
      password,
      userId: user.id,
      payload: sessionSyncPayloadSchema.parse(recorded.body.payload),
      version: recorded.body.version as number,
    };
  }

  function operation(payload: SessionSyncPayload, baseVersion: number) {
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
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  }
  function planOperation(payload: unknown, baseVersion: number | null) {
    const parsed = planSyncMutationSchema.parse(payload);
    return {
      id: randomUUID(),
      entityType: 'workout_plan',
      entityId: parsed.id,
      operation: 'upsert',
      idempotencyKey: randomUUID(),
      payloadHash: createHash('sha256').update(canonicalJsonString(parsed)).digest('hex'),
      baseVersion,
      createdAt: new Date().toISOString(),
      payload: parsed,
    };
  }
  function offline(f: Fixture) {
    const p = structuredClone(f.payload);
    p.id = randomUUID();
    p.status = 'completed';
    p.endedAt = new Date().toISOString();
    p.exerciseSessions[0]!.id = randomUUID();
    p.performedSets = p.performedSets.map((set) => ({
      ...set,
      id: randomUUID(),
      exerciseSessionId: p.exerciseSessions[0]!.id,
    }));
    return p;
  }
  async function graph(f: Fixture) {
    return JSON.stringify(
      await db.workoutSession.findUnique({
        where: { id: f.payload.id },
        include: {
          exercises: { include: { sets: { include: { corrections: true } }, feedback: true } },
          timeEvents: true,
        },
      }),
    );
  }
  it('CAS: only one concurrent sync wins; revision and receipt commit once, replay does not add a revision', async () => {
    const f = await fixture('CAS');
    const version = f.payload.planVersion;
    const ops = ['One', 'Two'].map((name) =>
      planOperation({ ...f.payload.planSnapshot, name }, version),
    );
    const responses = await Promise.all(
      ops.map((op) => post(f.token, '/sync', { operations: [op] }, 201)),
    );
    expect(responses.map((row) => row.body.results[0].status).sort()).toEqual([
      'applied',
      'conflict',
    ]);
    const stored = await db.workoutPlan.findUniqueOrThrow({ where: { id: f.payload.planId } });
    expect(stored.version).toBe(version + 1);
    expect(await db.workoutPlanRevision.count({ where: { planId: stored.id } })).toBe(version + 1);
    const winner = responses.findIndex((row) => row.body.results[0].status === 'applied');
    await post(f.token, '/sync', { operations: [ops[winner]!] }, 201);
    expect((await db.workoutPlan.findUniqueOrThrow({ where: { id: stored.id } })).version).toBe(
      version + 1,
    );
    expect(
      await db.syncOperation.count({ where: { entityId: stored.id, status: 'applied' } }),
    ).toBe(1);
  });
  it('CAS: two REST updates with the same expected version give 200/409 and one increment', async () => {
    const f = await fixture('REST CAS');
    const results = await Promise.all(
      ['A', 'B'].map((name) =>
        request(server())
          .patch(`/api/v1/workout-plans/${f.payload.planId}`)
          .set('Authorization', `Bearer ${f.token}`)
          .send({ baseVersion: f.payload.planVersion, name, description: null }),
      ),
    );
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    expect(
      (await db.workoutPlan.findUniqueOrThrow({ where: { id: f.payload.planId } })).version,
    ).toBe(f.payload.planVersion + 1);
  });
  it.each(['completed', 'aborted'] as const)(
    'terminal %s rejects every new operational child and accepts proven sync/REST retry without mutations',
    async (terminal) => {
      const f = await fixture(terminal);
      const op = operation(f.payload, f.version);
      await post(f.token, '/sync', { operations: [op] }, 201);
      const correctionId = randomUUID();
      const correction = { id: correctionId, repetitions: 9, reason: 'Confirmed before terminal' };
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/sets/${f.payload.performedSets[0]!.id}/correct`,
        correction,
        200,
      );
      const feedback = { perceivedLevel: 5, comment: 'Confirmed before terminal' };
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
        feedback,
        200,
      );
      if (terminal === 'completed')
        await post(
          f.token,
          `/workout-sessions/${f.payload.id}/finish`,
          { confirmIncomplete: true },
          200,
        );
      else await post(f.token, `/workout-sessions/${f.payload.id}/cancel`, { confirm: true }, 200);
      const before = await graph(f);
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/sets/${f.payload.performedSets[0]!.id}/correct`,
        correction,
        200,
      );
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
        feedback,
        200,
      );
      expect(await graph(f)).toBe(before);
      const replay = await post(f.token, '/sync', { operations: [op] }, 201);
      expect(replay.body.results[0].status).toBe('applied');
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/sets`,
        {
          id: f.payload.performedSets[0]!.id,
          exerciseSessionId: f.payload.exerciseSessions[0]!.id,
          repetitions: 8,
        },
        200,
      );
      await post(
        f.token,
        `/workout-sessions/${f.payload.id}/sets`,
        {
          id: f.payload.performedSets[0]!.id,
          exerciseSessionId: f.payload.exerciseSessions[0]!.id,
          repetitions: 99,
        },
        409,
      );
      const paths = [
        [
          '/sets',
          {
            id: randomUUID(),
            exerciseSessionId: f.payload.exerciseSessions[0]!.id,
            repetitions: 8,
          },
        ],
        [
          `/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
          { perceivedLevel: 4, comment: 'Late' },
        ],
        ['/rest', { action: 'start', durationSeconds: 30 }],
        [
          `/sets/${f.payload.performedSets[0]!.id}/correct`,
          { id: randomUUID(), repetitions: 12, reason: 'Late' },
        ],
      ] as const;
      for (const [path, body] of paths)
        await post(f.token, `/workout-sessions/${f.payload.id}${path}`, body, 409);
      for (const kind of ['set', 'correction', 'feedback', 'event'] as const) {
        const p = structuredClone(f.payload);
        if (kind === 'set')
          p.performedSets.push({ ...p.performedSets[0]!, id: randomUUID(), setIndex: 2 });
        if (kind === 'correction')
          p.corrections.push({
            id: randomUUID(),
            performedSetId: p.performedSets[0]!.id,
            repetitions: 12,
            load: null,
            loadUnit: null,
            voided: false,
            reason: 'Late',
            createdAt: new Date().toISOString(),
          });
        if (kind === 'feedback')
          p.feedback.push({
            id: randomUUID(),
            version: 0,
            exerciseSessionId: p.exerciseSessions[0]!.id,
            perceivedLevel: 4,
            comment: 'Late',
          });
        if (kind === 'event')
          p.timeEvents.push({
            id: randomUUID(),
            kind: 'pause',
            occurredAt: new Date().toISOString(),
            restDurationSeconds: null,
            exerciseSessionId: null,
          });
        const result = await post(f.token, '/sync', { operations: [operation(p, f.version)] }, 201);
        expect(result.body.results[0].status).toBe('conflict');
        expect(await graph(f)).toBe(before);
      }
    },
  );
  it('finish racing a set is serialized and never leaks HTTP 500 or inserts after the terminal commit', async () => {
    const f = await fixture('Finish race');
    const held = gate(),
      release = gate();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM meutreino.workout_sessions WHERE id=${f.payload.id}::uuid FOR UPDATE`;
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const calls = [
      request(server())
        .post(`/api/v1/workout-sessions/${f.payload.id}/finish`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({ confirmIncomplete: true })
        .then((row) => row),
      request(server())
        .post(`/api/v1/workout-sessions/${f.payload.id}/sets`)
        .set('Authorization', `Bearer ${f.token}`)
        .send({
          id: randomUUID(),
          exerciseSessionId: f.payload.exerciseSessions[0]!.id,
          repetitions: 8,
        })
        .then((row) => row),
    ];
    await new Promise((resolve) => setTimeout(resolve, 100));
    release.resolve();
    await blocker;
    const result = await Promise.all(calls);
    expect(result.every((row) => [200, 409].includes(row.status))).toBe(true);
    expect(result[0]!.status).toBe(200);
    const session = await db.workoutSession.findUniqueOrThrow({ where: { id: f.payload.id } });
    expect(session.status).toBe('completed');
    const sets = await db.performedSet.findMany({
      where: { exerciseSession: { workoutSessionId: session.id } },
    });
    expect(sets.every((set) => set.createdAt <= session.lockedAt!)).toBe(true);
  });
  const mutations: Array<[string, (p: SessionSyncPayload) => void]> = [
    [
      'name',
      (p) => {
        p.planSnapshot.name = 'Forged';
      },
    ],
    [
      'description',
      (p) => {
        p.planSnapshot.description = 'Forged';
      },
    ],
    [
      'accent',
      (p) => {
        p.planSnapshot.accent = 'pink';
      },
    ],
    [
      'status',
      (p) => {
        p.planSnapshot.status = 'archived';
      },
    ],
    [
      'exercise order',
      (p) => {
        p.planSnapshot.exercises[0]!.orderIndex = 2;
      },
    ],
    [
      'exercise rest',
      (p) => {
        p.planSnapshot.exercises[0]!.restSeconds = 180;
      },
    ],
    [
      'exercise notes',
      (p) => {
        p.planSnapshot.exercises[0]!.notes = 'Forged';
      },
    ],
    [
      'set order',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.setIndex = 2;
      },
    ],
    [
      'repetitions',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.repetitions = 99;
      },
    ],
    [
      'load',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.load = '999.00';
      },
    ],
    [
      'unit',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.loadUnit = 'lb';
      },
    ],
    [
      'set rest',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.restSeconds = 180;
      },
    ],
    [
      'set kind',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.kind = 'warmup';
      },
    ],
    [
      'load type',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.loadType = 'progressive';
      },
    ],
    [
      'duration',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.durationSeconds = 30;
      },
    ],
    [
      'set notes',
      (p) => {
        p.planSnapshot.exercises[0]!.sets[0]!.notes = 'Forged';
      },
    ],
    [
      'omit set',
      (p) => {
        p.planSnapshot.exercises[0]!.sets = [];
      },
    ],
    [
      'add set',
      (p) => {
        p.planSnapshot.exercises[0]!.sets.push({
          ...p.planSnapshot.exercises[0]!.sets[0]!,
          id: randomUUID(),
          setIndex: 2,
        });
      },
    ],
    [
      'omit exercise',
      (p) => {
        p.planSnapshot.exercises = [];
      },
    ],
    [
      'external exercise',
      (p) => {
        p.planSnapshot.exercises[0]!.exerciseId = randomUUID();
      },
    ],
    [
      'nonexistent revision',
      (p) => {
        p.planVersion = 999;
        p.planSnapshot.version = 999;
      },
    ],
  ];
  let canonical: Fixture;
  beforeAll(async () => {
    canonical = await fixture('Canonical');
  });
  it.each(mutations)(
    'canonical snapshot rejects %s with no partial data or success receipt',
    async (_name, mutate) => {
      const p = offline(canonical);
      mutate(p);
      const op = operation(p, null as never);
      const before = await db.workoutSession.count({ where: { userId: canonical.userId } });
      await post(canonical.token, '/sync', { operations: [op] }, 400);
      expect(await db.workoutSession.count({ where: { userId: canonical.userId } })).toBe(before);
      expect(await db.syncOperation.count({ where: { id: op.id } })).toBe(0);
    },
  );
  it('canonical old revision remains legitimate after the live plan has changed; server labels and times win', async () => {
    const f = await fixture('Old canonical');
    const p = offline(f);
    p.planSnapshot.createdAt = '2020-01-01T00:00:00.000Z';
    p.planSnapshot.exercises[0]!.exerciseName = 'Local presentation';
    const next = planOperation(
      { ...f.payload.planSnapshot, name: 'New live plan' },
      f.payload.planVersion,
    );
    await post(f.token, '/sync', { operations: [next] }, 201);
    const op = operation(p, null as never);
    for (let i = 0; i < 2; i++) {
      const result = await post(f.token, '/sync', { operations: [op] }, 201);
      expect(result.body.results[0].status).toBe('applied');
    }
    const stored = await db.workoutSession.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.planVersion).toBe(f.payload.planVersion);
    expect(stored.planSnapshot).toEqual(f.payload.planSnapshot);
  });
  it('offline origins A→B return stable official mappings; T references A after B has been published', async () => {
    const f = await fixture('Origins');
    const planId = randomUUID(),
      originA = randomUUID(),
      originB = randomUUID();
    const a = planSyncPayloadSchema.parse({
      ...f.payload.planSnapshot,
      id: planId,
      exercises: f.payload.planSnapshot.exercises.map((ex) => ({
        ...ex,
        id: randomUUID(),
        sets: ex.sets.map((set) => ({ ...set, id: randomUUID() })),
      })),
    });
    const b = structuredClone(a);
    b.name = 'B posterior';
    b.exercises[0]!.sets[0]!.repetitions = 12;
    const opA = planOperation({ ...a, revisionOrigin: { id: originA, parentId: null } }, null);
    const opB = planOperation({ ...b, revisionOrigin: { id: originB, parentId: originA } }, null);
    const missing = await post(f.token, '/sync', { operations: [opB] }, 201);
    expect(missing.body.results[0].code).toBe('plan_dependency_missing');
    expect(await db.syncOperation.count({ where: { id: opB.id } })).toBe(0);
    const ackA = await post(f.token, '/sync', { operations: [opA] }, 201);
    expect(ackA.body.results[0].revision.version).toBe(1);
    await post(f.token, '/sync', { operations: [opB] }, 201);
    const retry = await post(f.token, '/sync', { operations: [opA] }, 201);
    expect(retry.body).toEqual(ackA.body);
    expect(await db.planRevisionOrigin.count({ where: { planId } })).toBe(2);
    expect((await db.workoutPlan.findUniqueOrThrow({ where: { id: planId } })).version).toBe(2);
    const p = offline(f);
    p.planId = planId;
    p.planName = a.name;
    p.planVersion = 1;
    p.planSnapshot = ackA.body.results[0].revision.snapshot as SessionSyncPayload['planSnapshot'];
    p.exerciseSessions[0]!.planExerciseId = a.exercises[0]!.id;
    p.performedSets[0]!.plannedSetId = null;
    const result = await post(f.token, '/sync', { operations: [operation(p, null as never)] }, 201);
    expect(result.body.results[0].status).toBe('applied');
    const stored = await db.workoutSession.findUniqueOrThrow({ where: { id: p.id } });
    expect(
      (stored.planSnapshot as { exercises: Array<{ sets: Array<{ repetitions: number }> }> })
        .exercises[0]!.sets[0]!.repetitions,
    ).toBe(8);
    const stable = (await db.workoutPlan.findUniqueOrThrow({ where: { id: planId } })).version;
    const reused = await post(
      f.token,
      '/sync',
      {
        operations: [
          {
            ...opA,
            payload: { ...opA.payload, name: 'Forged' },
            payloadHash: createHash('sha256')
              .update(canonicalJsonString({ ...opA.payload, name: 'Forged' }))
              .digest('hex'),
          },
        ],
      },
      201,
    );
    expect(reused.body.results[0].status).toBe('rejected');
    expect((await db.workoutPlan.findUniqueOrThrow({ where: { id: planId } })).version).toBe(
      stable,
    );
  });
  it('plan origin insertion failure rolls back the live tree, official revision AND receipt', async () => {
    const f = await fixture('Atomic origin');
    const origin = randomUUID();
    const op = planOperation(
      {
        ...f.payload.planSnapshot,
        name: 'Must rollback',
        revisionOrigin: { id: origin, parentId: null },
      },
      f.payload.planVersion,
    );
    const snapshot = async () =>
      JSON.stringify(
        await db.workoutPlan.findUnique({
          where: { id: f.payload.planId },
          include: { exercises: { include: { sets: true } }, revisions: true },
        }),
      );
    const before = await snapshot();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION meutreino.recovery04_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${origin}'::uuid THEN RAISE EXCEPTION 'injected origin failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER recovery04_test_failure BEFORE INSERT ON meutreino.plan_revision_origins FOR EACH ROW EXECUTE FUNCTION meutreino.recovery04_test_failure()',
    );
    try {
      await post(f.token, '/sync', { operations: [op] }, 500);
      expect(await snapshot()).toBe(before);
      expect(await db.syncOperation.count({ where: { id: op.id } })).toBe(0);
      expect(await db.planRevisionOrigin.count({ where: { id: origin } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER recovery04_test_failure ON meutreino.plan_revision_origins',
      );
      await db.$executeRawUnsafe('DROP FUNCTION meutreino.recovery04_test_failure()');
    }
    const result = await post(f.token, '/sync', { operations: [op] }, 201);
    expect(result.body.results[0].revision.version).toBe(f.payload.planVersion + 1);
  });
  it('origins cannot use another user/another plan as their predecessor, and keys cannot move to a different plan', async () => {
    const a = await fixture('Origin A');
    const b = await fixture('Origin B');
    const id = randomUUID();
    const first = planOperation(
      { ...a.payload.planSnapshot, revisionOrigin: { id, parentId: null } },
      a.payload.planVersion,
    );
    await post(a.token, '/sync', { operations: [first] }, 201);
    const foreign = planOperation(
      { ...b.payload.planSnapshot, revisionOrigin: { id: randomUUID(), parentId: id } },
      b.payload.planVersion,
    );
    const before = (await db.workoutPlan.findUniqueOrThrow({ where: { id: b.payload.planId } }))
      .version;
    const result = await post(b.token, '/sync', { operations: [foreign] }, 201);
    expect(result.body.results[0].code).toBe('plan_dependency_missing');
    expect(
      (await db.workoutPlan.findUniqueOrThrow({ where: { id: b.payload.planId } })).version,
    ).toBe(before);
    const other = planOperation(
      {
        ...a.payload.planSnapshot,
        id: randomUUID(),
        revisionOrigin: { id: randomUUID(), parentId: id },
      },
      null,
    );
    const mismatch = await post(a.token, '/sync', { operations: [other] }, 201);
    expect(mismatch.body.results[0].code).toBe('plan_dependency_missing');
    const key = planOperation({ ...a.payload.planSnapshot, name: 'Other' }, a.payload.planVersion);
    key.idempotencyKey = first.idempotencyKey;
    const reuse = await post(a.token, '/sync', { operations: [key] }, 201);
    expect(reuse.body.results[0].code).toBe('idempotency_key_reused');
  });
  it('a plan conflict resolution binds only the EXACT preserved source and keeps an immutable origin receipt on retry', async () => {
    const f = await fixture('Source conflict');
    const origin = randomUUID();
    const op = planOperation(
      { ...f.payload.planSnapshot, revisionOrigin: { id: origin, parentId: null } },
      f.payload.planVersion,
    );
    await request(server())
      .patch(`/api/v1/workout-plans/${f.payload.planId}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ baseVersion: f.payload.planVersion, name: 'Remote', description: null })
      .expect(200);
    const conflict = await post(f.token, '/sync', { operations: [op] }, 201);
    expect(conflict.body.results[0].status).toBe('conflict');
    const body = { choice: 'keep_local', payload: op.payload };
    const result = await post(f.token, `/workout-plan-conflicts/${op.id}/resolve`, body, 200);
    expect(result.body.revision.originId).toBe(origin);
    const revision = result.body.revision;
    const retry = await post(f.token, `/workout-plan-conflicts/${op.id}/resolve`, body, 200);
    expect(retry.body.revision).toEqual(revision);
    expect(await db.planRevisionOrigin.count({ where: { id: origin } })).toBe(1);
  });
  it('a planned set cannot forge its copied prescription even with a legitimate official snapshot', async () => {
    const f = await fixture('Planned copy');
    const p = offline(f);
    p.performedSets[0]!.plannedSetId = p.planSnapshot.exercises[0]!.sets[0]!.id;
    p.performedSets[0]!.plannedRepetitions = 99;
    const op = operation(p, null as never);
    await post(f.token, '/sync', { operations: [op] }, 400);
    expect(await db.workoutSession.count({ where: { id: p.id } })).toBe(0);
    expect(await db.syncOperation.count({ where: { id: op.id } })).toBe(0);
  });

  it('REAL SQLite + HTTP + PostgreSQL: A offline, T, edit B, timeout after commit, restart, original revision preserved', async () => {
    const f = await fixture('End to end');
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/finish`,
      { confirmIncomplete: true },
      200,
    );
    const { harness } = createRequire(__filename)(
      '../../mobile/test/support/sqlite-harness.cjs',
    ) as { harness: () => Promise<MobileHarness> };
    const h = await harness();
    try {
      const plans = h.load('plans/plan-store');
      const plan = await plans.createLocalPlan(h.user, {
        name: 'Original offline',
        description: null,
        accent: null,
      });
      await plans.updateLocalPlan(h.user, plan.id, (draft: PlanSyncPayload) => {
        draft.exercises.push({
          ...structuredClone(f.payload.planSnapshot.exercises[0]!),
          id: randomUUID(),
          sets: f.payload.planSnapshot.exercises[0]!.sets.map((set) => ({
            ...set,
            id: randomUUID(),
          })),
        });
      });
      const session = await h.store.startLocalSession(h.user, plan.id, null, false);
      await h.store.recordLocalSet(h.user, session.id, {
        exerciseSessionId: session.exerciseSessions[0].id,
        plannedSetId: session.planSnapshot.exercises[0].sets[0].id,
        repetitions: 8,
        load: null,
        loadUnit: null,
        outcome: 'completed',
      });
      await plans.updateLocalPlan(h.user, plan.id, (draft: PlanSyncPayload) => {
        draft.name = 'Posterior offline';
        draft.exercises[0].sets[0].repetitions = 12;
      });
      let lose = true;
      h.api.pushCatalogSync = async (operations: unknown[]) => {
        const response = await post(f.token, '/sync', { operations }, 201);
        if (lose) {
          lose = false;
          throw new h.errors.ApiClientError('Lost after commit', 0, 'network_error');
        }
        return response.body;
      };
      h.api.pushSessionSync = async (operations: unknown[]) =>
        (await post(f.token, '/sync', { operations }, 201)).body;
      h.api.listPlansRequest = async (page: number) =>
        (
          await request(server())
            .get(`/api/v1/workout-plans?page=${page}&pageSize=50&includeArchived=true`)
            .set('Authorization', `Bearer ${f.token}`)
            .expect(200)
        ).body;
      h.api.getSessionRequest = async (id: string) =>
        (
          await request(server())
            .get(`/api/v1/workout-sessions/${id}`)
            .set('Authorization', `Bearer ${f.token}`)
            .expect(200)
        ).body;
      h.api.openSessionRequest = async () =>
        (
          await request(server())
            .get('/api/v1/workout-sessions/open')
            .set('Authorization', `Bearer ${f.token}`)
            .expect(200)
        ).body;
      const interrupted = await h.store.syncSessions(h.user);
      expect(interrupted.synced).toBe(false);
      await h.reopen();
      const resumed = await h.store.syncSessions(h.user);
      expect(resumed.synced).toBe(true);
      const local = await h.store.readLocalSession(h.user, session.id);
      expect(local.pending).toBe(false);
      expect(local.planVersion).toBe(2);
      expect(local.planSnapshot.version).toBe(2);
      expect(local.planSnapshot.exercises[0].sets[0].repetitions).toBe(8);
      const live = await db.workoutPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: { revisions: true },
      });
      expect(live.version).toBe(3);
      expect(live.name).toBe('Posterior offline');
      expect(live.revisions).toHaveLength(3);
      const stored = await db.workoutSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { exercises: { include: { sets: true } } },
      });
      expect(stored.planVersion).toBe(2);
      expect(stored.exercises[0]!.sets).toHaveLength(1);
      expect(await db.planRevisionOrigin.count({ where: { planId: plan.id } })).toBe(3);
      expect(await db.workoutSession.count({ where: { id: session.id } })).toBe(1);
    } finally {
      await h.close();
    }
  });
  async function reconcileFixture() {
    const f = await fixture('Recovery 04.2');
    const a = planOperation(
      {
        ...f.payload.planSnapshot,
        name: 'A',
        revisionOrigin: { id: randomUUID(), parentId: null },
      },
      f.payload.planVersion,
    );
    const b = planOperation(
      {
        ...f.payload.planSnapshot,
        name: 'B',
        revisionOrigin: { id: randomUUID(), parentId: a.payload.revisionOrigin!.id },
      },
      f.payload.planVersion,
    );
    await request(server())
      .patch(`/api/v1/workout-plans/${f.payload.planId}`)
      .set('Authorization', `Bearer ${f.token}`)
      .send({ baseVersion: f.payload.planVersion, name: 'C' })
      .expect(200);
    const conflict = await post(f.token, '/sync', { operations: [a] }, 201);
    expect(conflict.body.results[0].status).toBe('conflict');
    // A request already sent must remain byte-identical when it is closed later.
    const attempted = await post(f.token, '/sync', { operations: [b] }, 201);
    expect(attempted.body.results[0].code).toBe('plan_dependency_missing');
    return {
      f,
      a,
      b,
      body: {
        id: randomUUID(),
        expectedVersion: f.payload.planVersion + 1,
        choice: 'keep_server',
        descendants: 'archive',
        sourceOriginId: null as string | null,
        operations: [a, b],
      },
    };
  }
  it.each([
    ['keep_server', 'archive'],
    ['keep_server', 'reapply'],
    ['keep_both', 'archive'],
    ['keep_both', 'reapply'],
  ] as const)(
    'Recovery 04.2 %s/%s has one immutable receipt, closes attempted operations and never changes original snapshots',
    async (choice, descendants) => {
      const s = await reconcileFixture();
      const body = {
        ...s.body,
        choice,
        descendants,
        sourceOriginId: descendants === 'reapply' ? s.b.payload.revisionOrigin!.id : null,
      };
      const before = await db.syncOperation.findUniqueOrThrow({ where: { id: s.a.id } });
      const path = `/workout-plan-conflicts/${s.a.id}/reconcile`;
      const result = await post(s.f.token, path, body, 200);
      expect(result.body.plan.name).toBe(
        choice === 'keep_server' && descendants === 'reapply' ? 'B' : 'C',
      );
      expect(result.body.preservedPlan?.name ?? null).toBe(
        choice === 'keep_both' ? (descendants === 'reapply' ? 'B' : 'A (cópia)') : null,
      );
      expect(await db.planOperationClosure.count({ where: { decisionId: body.id } })).toBe(2);
      expect(await db.planReconciliation.count({ where: { id: body.id } })).toBe(1);
      expect(await db.syncOperation.findUniqueOrThrow({ where: { id: s.a.id } })).toEqual(before);
      const stored = await db.planReconciliation.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.request).toEqual(body);
      expect(stored.result).toEqual(result.body);
      const retry = await post(s.f.token, path, body, 200);
      expect(retry.body).toEqual(result.body);
      for (const op of [s.a, s.b]) {
        const late = await post(s.f.token, '/sync', { operations: [op] }, 201);
        expect(late.body.results[0]).toMatchObject({
          status: 'rejected',
          code: 'operation_closed',
        });
      }
      if (descendants === 'reapply') {
        expect(result.body.derived.sourceOriginId).toBe(s.b.payload.revisionOrigin!.id);
        expect(result.body.derived.operation.payload.revisionOrigin.parentId).toBeNull();
        const origin = await db.planRevisionOrigin.findUniqueOrThrow({
          where: { id: result.body.derived.revision.originId },
        });
        expect(origin.snapshot).toEqual(result.body.derived.revision.snapshot);
        expect(
          await db.syncOperation.count({
            where: { id: result.body.derived.operation.id, status: 'applied' },
          }),
        ).toBe(1);
        const repeated = await post(
          s.f.token,
          '/sync',
          { operations: [result.body.derived.operation] },
          201,
        );
        expect(repeated.body.results[0].status).toBe('applied');
      }
      expect(
        await db.planRevisionOrigin.count({
          where: { id: { in: [s.a.payload.revisionOrigin!.id, s.b.payload.revisionOrigin!.id] } },
        }),
      ).toBe(0);
      await post(
        s.f.token,
        path,
        { ...body, descendants: descendants === 'archive' ? 'reapply' : 'archive' },
        409,
      );
      const target = result.body.preservedPlan ?? result.body.plan;
      await request(server())
        .patch(`/api/v1/workout-plans/${target.id}`)
        .set('Authorization', `Bearer ${s.f.token}`)
        .send({ baseVersion: target.version, name: 'After decision' })
        .expect(200);
      expect((await post(s.f.token, path, body, 200)).body).toEqual(result.body);
      expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(
        choice === 'keep_both' ? 2 : 1,
      );
      await expect(
        db.$executeRaw`UPDATE meutreino.plan_reconciliations SET request_hash='forged' WHERE id=${body.id}::uuid`,
      ).rejects.toThrow();
    },
  );
  it('Recovery 04.2 two devices resolving concurrently get one winner, with no second Q or E', async () => {
    const s = await reconcileFixture();
    const body = {
      ...s.body,
      choice: 'keep_both',
      descendants: 'reapply',
      sourceOriginId: s.b.payload.revisionOrigin!.id,
    };
    const login = await post(
      s.f.token,
      '/auth/login',
      {
        email: s.f.email,
        password: s.f.password,
        device: {
          installationId: randomUUID(),
          platform: 'ios',
          appVersion: '0.1.0',
          label: 'Second device',
        },
      },
      200,
    );
    const results = await Promise.all(
      [s.f.token, login.body.tokens.accessToken as string].map((token, i) =>
        request(server())
          .post(`/api/v1/workout-plan-conflicts/${s.a.id}/reconcile`)
          .set('Authorization', `Bearer ${token}`)
          .send({ ...body, id: i ? randomUUID() : body.id }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.planReconciliation.count({ where: { conflictId: s.a.id } })).toBe(1);
    expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(2);
    expect(await db.planRevisionOrigin.count({ where: { userId: s.f.userId } })).toBe(1);
  });
  it('Recovery 04.2 stale C and invalid operation hashes fail without partial closures or Q/E', async () => {
    const s = await reconcileFixture();
    await post(
      s.f.token,
      `/workout-plan-conflicts/${s.a.id}/reconcile`,
      { ...s.body, expectedVersion: 1 },
      409,
    );
    const invalid = { ...s.body, operations: [s.a, { ...s.b, payloadHash: '0'.repeat(64) }] };
    await post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, invalid, 400);
    expect(await db.planOperationClosure.count({ where: { userId: s.f.userId } })).toBe(0);
    expect(await db.planReconciliation.count({ where: { userId: s.f.userId } })).toBe(0);
    expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(1);
  });
  describe('isolated historical ACK integration', () => {
    // Keep the real throttler enabled; this workload has its own HTTP rate budget.
    beforeAll(async () => {
      await app.close();
      await startApp();
    });
    it.each(['none', 'pending', 'published'] as const)(
      'Recovery 04.2 REAL SQLite + HTTP + PostgreSQL: lost ACK with %s F, restart and one Q/E',
      async (successor) => {
        const s = await reconcileFixture();
        await post(
          s.f.token,
          `/workout-sessions/${s.f.payload.id}/finish`,
          { confirmIncomplete: true },
          200,
        );
        const { harness } = createRequire(__filename)(
          '../../mobile/test/support/sqlite-harness.cjs',
        ) as { harness: () => Promise<MobileHarness> };
        const h = await harness();
        try {
          // Keep local identities tied to the actual user-owned plan and exercise IDs.
          const dbLocal = (
            h as unknown as {
              db: { runAsync: (sql: string, ...args: unknown[]) => Promise<unknown> };
            }
          ).db;
          await dbLocal.runAsync('DELETE FROM plans');
          await dbLocal.runAsync(
            "INSERT INTO plans(id,name,description,accent,status,version,payload,updated_at,pending,synced) VALUES(?, ?,NULL,NULL,'active',?,?,?,0,1)",
            s.f.payload.planId,
            'Official',
            s.f.payload.planVersion,
            JSON.stringify(s.f.payload.planSnapshot),
            new Date().toISOString(),
          );
          const plans = h.load('plans/plan-store') as ReturnType<MobileHarness['load']> & {
            syncPlans: (user: string) => Promise<unknown>;
            reconcileLocalPlanConflict: (
              user: string,
              id: string,
              choice: string,
              desc: string,
              source: string,
            ) => Promise<void>;
          };
          await plans.updateLocalPlan(h.user, s.f.payload.planId, (p) => {
            p.name = 'Offline A';
          });
          await plans.updateLocalPlan(h.user, s.f.payload.planId, (p) => {
            p.name = 'Offline B';
          });
          const api = h.api as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
          api.pushCatalogSync = (async (operations: unknown[]) =>
            (await post(s.f.token, '/sync', { operations }, 201))
              .body) as typeof api.pushCatalogSync;
          api.listPlansRequest = (async () =>
            (
              await request(server())
                .get('/api/v1/workout-plans?page=1&pageSize=50&includeArchived=true')
                .set('Authorization', `Bearer ${s.f.token}`)
                .expect(200)
            ).body) as typeof api.listPlansRequest;
          api.getPlanRequest = (async (id: string) =>
            (
              await request(server())
                .get(`/api/v1/workout-plans/${id}`)
                .set('Authorization', `Bearer ${s.f.token}`)
                .expect(200)
            ).body) as typeof api.getPlanRequest;
          await plans.syncPlans(h.user);
          const rows = await (
            h as unknown as {
              db: {
                getAllAsync: (sql: string) => Promise<Array<{ id: string; snapshot: string }>>;
              };
            }
          ).db.getAllAsync('SELECT * FROM local_plan_revisions ORDER BY rowid');
          let lost = true;
          api.reconcilePlanConflictRequest = (async (id: string, body: object) => {
            const response = await post(
              s.f.token,
              `/workout-plan-conflicts/${id}/reconcile`,
              body,
              200,
            );
            if (lost) {
              lost = false;
              throw new h.errors.ApiClientError('lost ACK', 0, 'network_error');
            }
            return response.body;
          }) as typeof api.reconcilePlanConflictRequest;
          await expect(
            plans.reconcileLocalPlanConflict(
              h.user,
              s.f.payload.planId,
              'keep_both',
              'reapply',
              rows[1]!.id,
            ),
          ).rejects.toThrow('Retomar');
          const remoteDecision = await db.planReconciliation.findFirstOrThrow({
            where: { userId: s.f.userId },
          });
          const confirmed = remoteDecision.result as unknown as {
            preservedPlan: { id: string; version: number };
          };
          const qid = confirmed.preservedPlan.id;
          const queryLocal = () =>
            (
              h as unknown as {
                db: {
                  getAllAsync: (sql: string) => Promise<
                    Array<{
                      id: string;
                      name: string;
                      version: number;
                      pending: number;
                      local_revision: number;
                      acknowledged_revision: number;
                      origin_revision_id: string | null;
                    }>
                  >;
                };
              }
            ).db;
          let liveBefore:
            Awaited<ReturnType<ReturnType<typeof queryLocal>['getAllAsync']>>[number] | undefined;
          if (successor !== 'none') {
            await plans.syncPlans(h.user); // Real HTTP list discovers Q before the lost ACK is retried.
            await plans.updateLocalPlan(h.user, qid, (p) => {
              p.name = 'F before decision ACK';
            });
            if (successor === 'published') await plans.syncPlans(h.user);
            liveBefore = (await queryLocal().getAllAsync('SELECT * FROM plans')).find(
              (row) => row.id === qid,
            );
            expect(liveBefore?.pending).toBe(successor === 'pending' ? 1 : 0);
          }
          await h.reopen();
          const reopened = h.load('plans/plan-store') as typeof plans;
          await reopened.reconcileLocalPlanConflict(
            h.user,
            s.f.payload.planId,
            'keep_both',
            'reapply',
            rows[1]!.id,
          );
          const after = await (
            h as unknown as {
              db: {
                getAllAsync: (sql: string) => Promise<Array<{ id: string; snapshot: string }>>;
              };
            }
          ).db.getAllAsync('SELECT * FROM local_plan_revisions ORDER BY rowid');
          expect(after.slice(0, 2).map((r) => r.snapshot)).toEqual(rows.map((r) => r.snapshot));
          expect(after).toHaveLength(successor === 'none' ? 3 : 4);
          if (liveBefore) {
            const liveAfter = (await queryLocal().getAllAsync('SELECT * FROM plans')).find(
              (row) => row.id === qid,
            )!;
            for (const key of [
              'name',
              'version',
              'pending',
              'local_revision',
              'acknowledged_revision',
              'origin_revision_id',
            ] as const)
              expect(liveAfter[key]).toEqual(liveBefore[key]);
            expect(liveAfter.name).toBe('F before decision ACK');
            if (successor === 'published')
              expect(liveAfter.version).toBeGreaterThan(confirmed.preservedPlan.version);
          }
          expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(2);
          const decisions = await db.planReconciliation.findMany({ where: { userId: s.f.userId } });
          expect(decisions).toHaveLength(1);
          const result = decisions[0]!.result as unknown as { preservedPlan: { id: string } };
          await reopened.updateLocalPlan(h.user, result.preservedPlan.id, (p) => {
            p.name = 'Edit after recovery';
          });
          await reopened.syncPlans(h.user);
          expect(
            (await db.workoutPlan.findUniqueOrThrow({ where: { id: result.preservedPlan.id } }))
              .name,
          ).toBe('Edit after recovery');
        } finally {
          await h.close();
        }
      },
    );
  });
  it('Recovery 04.2 decision insertion failure rolls back Q, E, closures and all plan changes', async () => {
    const s = await reconcileFixture();
    const body = {
      ...s.body,
      choice: 'keep_both',
      descendants: 'reapply',
      sourceOriginId: s.b.payload.revisionOrigin!.id,
    };
    const plans = async () =>
      JSON.stringify(
        await db.workoutPlan.findMany({
          where: { ownerUserId: s.f.userId },
          include: { revisions: true },
        }),
      );
    const before = await plans();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION meutreino.recovery042_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${body.id}'::uuid THEN RAISE EXCEPTION 'injected decision failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER recovery042_failure BEFORE INSERT ON meutreino.plan_reconciliations FOR EACH ROW EXECUTE FUNCTION meutreino.recovery042_failure()',
    );
    try {
      await post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, body, 500);
      expect(await plans()).toBe(before);
      expect(await db.planReconciliation.count({ where: { id: body.id } })).toBe(0);
      expect(await db.planOperationClosure.count({ where: { decisionId: body.id } })).toBe(0);
      expect(await db.planRevisionOrigin.count({ where: { userId: s.f.userId } })).toBe(0);
      expect(
        (await db.workoutPlanConflict.findUniqueOrThrow({ where: { id: s.a.id } })).status,
      ).toBe('open');
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER recovery042_failure ON meutreino.plan_reconciliations',
      );
      await db.$executeRawUnsafe('DROP FUNCTION meutreino.recovery042_failure()');
    }
    await post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, body, 200);
    expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(2);
  });
  it('Recovery 04.2 same decision concurrent retries return exactly one immutable result', async () => {
    const s = await reconcileFixture();
    const body = {
      ...s.body,
      choice: 'keep_both',
      descendants: 'reapply',
      sourceOriginId: s.b.payload.revisionOrigin!.id,
    };
    const results = await Promise.all(
      [0, 1].map(() => post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, body, 200)),
    );
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(await db.planReconciliation.count({ where: { id: body.id } })).toBe(1);
    expect(await db.planRevisionOrigin.count({ where: { userId: s.f.userId } })).toBe(1);
  });
  it('Recovery 04.2 in-flight old operation races closure without reactivating B', async () => {
    const s = await reconcileFixture();
    const results = await Promise.all([
      post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, s.body, 200),
      post(s.f.token, '/sync', { operations: [s.b] }, 201),
    ]);
    expect(results[1]!.body.results[0].status).not.toBe('applied');
    expect(
      (await db.workoutPlan.findUniqueOrThrow({ where: { id: s.f.payload.planId } })).name,
    ).toBe('C');
    const later = await post(s.f.token, '/sync', { operations: [s.b] }, 201);
    expect(later.body.results[0].code).toBe('operation_closed');
  });
  it('Recovery 04.2 decisions are isolated by user and included in export and purge', async () => {
    const s = await reconcileFixture();
    const other = await fixture('Reconciliation outsider');
    await post(other.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, s.body, 404);
    await post(s.f.token, `/workout-plan-conflicts/${s.a.id}/reconcile`, s.body, 200);
    const exported = await post(s.f.token, '/me/export', {}, 201);
    const file = await request(server())
      .get(`/api/v1/me/export/${exported.body.id}/download`)
      .set('Authorization', `Bearer ${s.f.token}`)
      .expect(200);
    const data = Buffer.isBuffer(file.body) ? JSON.parse(file.body.toString('utf8')) : file.body;
    expect(data.planReconciliations).toHaveLength(1);
    expect(data.planReconciliations[0].id).toBe(s.body.id);
    expect(data.planOperationClosures).toHaveLength(2);
    await app.get(DeletionService).purge(s.f.userId);
    expect(await db.planReconciliation.count({ where: { userId: s.f.userId } })).toBe(0);
    expect(await db.planOperationClosure.count({ where: { userId: s.f.userId } })).toBe(0);
    expect(await db.workoutPlan.count({ where: { ownerUserId: s.f.userId } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.f.userId } })).status).toBe('deleted');
  });
});
