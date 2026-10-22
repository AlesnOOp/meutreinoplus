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
import { PrismaService } from '../src/prisma/prisma.service';

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
describe('Recovery 03 real PostgreSQL conflict protocol', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  beforeAll(async () => {
    guard();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
    expect(
      (await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`)[0]!.name,
    ).toBe(process.env.EXPECTED_DATABASE);
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
  function get(f: Fixture, path: string) {
    return request(server()).get(`/api/v1${path}`).set('Authorization', `Bearer ${f.token}`);
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
  async function current(f: Fixture) {
    return (await get(f, `/workout-sessions/${f.payload.id}`).expect(200)).body;
  }
  async function open(f: Fixture, local: SessionSyncPayload = f.payload) {
    // A real remote write moves the version ahead of the offline base.
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
      { perceivedLevel: 2, comment: 'Remoto preservado' },
      200,
    );
    const op = operation(local, f.version);
    const response = await post(f.token, '/sync', { operations: [op] }, 201);
    expect(response.body.results[0].status).toBe('conflict');
    return op.id;
  }
  async function decision(
    f: Fixture,
    id: string,
    payload: SessionSyncPayload,
    choice = 'keep_local',
  ) {
    const preview = await post(
      f.token,
      `/workout-session-conflicts/${id}/preview`,
      { choice, localRevision: 5, payload },
      200,
    );
    return {
      choice,
      localRevision: 5,
      payload,
      expectedVersion: preview.body.remoteVersion as number,
      previewHash: preview.body.previewHash as string,
      idempotencyKey: randomUUID(),
      confirmDiscard: true,
    };
  }
  async function state(f: Fixture) {
    return JSON.stringify(
      await Promise.all([
        db.workoutSession.findUnique({ where: { id: f.payload.id } }),
        db.exerciseSession.findMany({
          where: { workoutSessionId: f.payload.id },
          include: { sets: { include: { corrections: true } }, feedback: true },
        }),
        db.sessionTimeEvent.findMany({ where: { workoutSessionId: f.payload.id } }),
        db.exerciseFeedbackRevision.findMany({ where: { feedback: { userId: f.userId } } }),
        db.workoutSessionConflict.findMany({ where: { workoutSessionId: f.payload.id } }),
        db.workoutSessionResolution.findMany({ where: { workoutSessionId: f.payload.id } }),
        db.workoutSessionVariant.findMany({ where: { workoutSessionId: f.payload.id } }),
      ]),
    );
  }
  it('persists offline feedback, retries once, and a fresh login downloads the same assessment and comment', async () => {
    const f = await fixture('feedback');
    const local = structuredClone(f.payload);
    local.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: local.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 5,
        comment: 'Offline completo',
      },
    ];
    const op = operation(local, f.version);
    for (let i = 0; i < 2; i++) {
      const result = await post(f.token, '/sync', { operations: [op] }, 201);
      expect(result.body.results[0].status).toBe('applied');
    }
    const stored = await db.exerciseFeedback.findUniqueOrThrow({
      where: { id: local.feedback[0]!.id },
    });
    expect(stored.comment).toBe('Offline completo');
    expect(stored.version).toBe(1);
    expect(await db.exerciseFeedbackRevision.count({ where: { feedbackId: stored.id } })).toBe(1);
    const login = await post(
      '',
      '/auth/login',
      {
        email: f.email,
        password: f.password,
        device: { installationId: randomUUID(), platform: 'ios', appVersion: '0.1.0' },
      },
      200,
    );
    const downloaded = await current({ ...f, token: login.body.tokens.accessToken as string });
    expect(downloaded.payload.feedback[0].comment).toBe('Offline completo');
    const changed = sessionSyncPayloadSchema.parse(downloaded.payload);
    changed.feedback[0]!.comment = 'Nova avaliação';
    const result = await post(
      f.token,
      '/sync',
      { operations: [operation(changed, downloaded.version as number)] },
      201,
    );
    expect(result.body.results[0].status).toBe('applied');
    expect(await db.exerciseFeedbackRevision.count({ where: { feedbackId: stored.id } })).toBe(2);
  });
  it('does not partially apply divergent feedback or stale mutable fields', async () => {
    const f = await fixture('divergence');
    const local = structuredClone(f.payload);
    local.notes = 'Local';
    local.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: local.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 5,
        comment: 'Local',
      },
    ];
    const id = await open(f, local);
    const stored = await current(f);
    expect(stored.payload.notes).toBeNull();
    expect(stored.payload.feedback[0].comment).toBe('Remoto preservado');
    expect(await db.workoutSessionConflict.count({ where: { id, status: 'open' } })).toBe(1);
  });
  it('keep_remote requires confirmation, preserves local execution in immutable recovery and keeps canonical remote', async () => {
    const f = await fixture('remote');
    const local = structuredClone(f.payload);
    local.notes = 'Somente local';
    local.performedSets.push({ ...local.performedSets[0]!, id: randomUUID(), setIndex: 2 });
    const id = await open(f, local);
    const input = await decision(f, id, local, 'keep_remote');
    const before = await state(f);
    await post(
      f.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, confirmDiscard: false },
      409,
    );
    expect(await state(f)).toBe(before);
    const resolved = await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    expect(resolved.body.payload.notes).toBeNull();
    expect(resolved.body.version).toBe(input.expectedVersion + 1);
    const variants = await get(f, `/workout-sessions/${f.payload.id}/variants`).expect(200);
    expect(variants.body).toHaveLength(2);
    expect(
      variants.body.find((row: { origin: string }) => row.origin === 'local').payload.performedSets,
    ).toHaveLength(2);
    expect(
      await db.performedSet.count({
        where: { exerciseSession: { workoutSessionId: f.payload.id } },
      }),
    ).toBe(1);
    await expect(
      db.workoutSessionVariant.update({
        where: { id: variants.body[0].id as string },
        data: { sourceRevision: 99 },
      }),
    ).rejects.toThrow();
  });
  it('keep_local reconciles extra sets, append-only corrections, feedback, notes, skipped exercises, pauses and completion, with frozen snapshot', async () => {
    const f = await fixture('local');
    const local = structuredClone(f.payload);
    local.notes = 'Escolha local';
    local.status = 'completed';
    local.performedSets[0]!.repetitions = 12;
    local.performedSets.push({
      ...local.performedSets[0]!,
      id: randomUUID(),
      setIndex: 2,
      repetitions: 6,
    });
    local.corrections = [
      {
        id: randomUUID(),
        performedSetId: local.performedSets[1]!.id,
        repetitions: 7,
        load: null,
        loadUnit: null,
        voided: false,
        reason: 'Correção local',
        createdAt: new Date().toISOString(),
      },
    ];
    local.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: local.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 5,
        comment: 'Local preservado',
      },
    ];
    local.exerciseSessions[0]!.status = 'skipped';
    local.exerciseSessions[0]!.skipReason = 'Dor';
    const start = Date.parse(local.startedAt);
    local.timeEvents = [
      {
        id: randomUUID(),
        kind: 'pause',
        occurredAt: new Date(start + 1).toISOString(),
        exerciseSessionId: null,
        restDurationSeconds: null,
      },
      {
        id: randomUUID(),
        kind: 'resume',
        occurredAt: new Date(start + 2).toISOString(),
        exerciseSessionId: null,
        restDurationSeconds: null,
      },
    ];
    local.endedAt = new Date(Math.max(Date.now(), start + 3)).toISOString();
    const id = await open(f, local);
    const input = await decision(f, id, local);
    const resolved = await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    expect(resolved.body.payload.notes).toBe(local.notes);
    expect(resolved.body.payload.status).toBe('completed');
    expect(resolved.body.payload.planSnapshot).toEqual(f.payload.planSnapshot);
    expect(resolved.body.payload.exerciseSessions[0].skipReason).toBe('Dor');
    expect(resolved.body.payload.feedback[0].comment).toBe('Local preservado');
    expect(resolved.body.version).toBe(input.expectedVersion + 1);
    expect(
      await db.performedSet.findUniqueOrThrow({ where: { id: f.payload.performedSets[0]!.id } }),
    ).toMatchObject({ performedRepetitions: 8 });
    expect(
      await db.performedSetCorrection.count({
        where: { performedSet: { exerciseSession: { workoutSessionId: f.payload.id } } },
      }),
    ).toBe(2);
    expect(await db.sessionTimeEvent.count({ where: { workoutSessionId: f.payload.id } })).toBe(2);
    const feedback = await db.exerciseFeedback.findUniqueOrThrow({
      where: { exerciseSessionId: local.exerciseSessions[0]!.id },
    });
    expect(await db.exerciseFeedbackRevision.count({ where: { feedbackId: feedback.id } })).toBe(2);
    const stable = await state(f);
    const retried = await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    expect(retried.body).toEqual(resolved.body);
    expect(await state(f)).toBe(stable);
  });
  it('keep_both stores TWO distinct accessible versions of ONE execution without duplicating sets or statistics', async () => {
    const f = await fixture('both');
    const local = structuredClone(f.payload);
    local.notes = 'Local separada';
    const id = await open(f, local);
    const remote = await current(f);
    const input = await decision(f, id, local, 'keep_both');
    await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    expect((await current(f)).payload).toEqual(remote.payload);
    const variants = await db.workoutSessionVariant.findMany({
      where: { workoutSessionId: f.payload.id },
    });
    expect(variants).toHaveLength(2);
    expect(new Set(variants.map((row) => row.origin)).size).toBe(2);
    expect(await db.workoutSession.count({ where: { userId: f.userId } })).toBe(1);
    expect(
      await db.performedSet.count({
        where: { exerciseSession: { workoutSessionId: f.payload.id } },
      }),
    ).toBe(1);
  });
  it.each(['pause', 'finish'] as const)(
    'keeps incompatible %s timelines and finalization OPEN until an explicit preserving choice',
    async (kind) => {
      const f = await fixture(kind);
      const id = await open(f);
      const local = structuredClone(f.payload);
      if (kind === 'pause') {
        const at = new Date().toISOString();
        await post(f.token, `/workout-sessions/${f.payload.id}/pause`, { occurredAt: at }, 200);
        local.status = 'paused';
        local.timeEvents.push({
          id: randomUUID(),
          kind: 'pause',
          occurredAt: new Date(Date.parse(at) + 1).toISOString(),
          exerciseSessionId: null,
          restDurationSeconds: null,
        });
      } else {
        await post(
          f.token,
          `/workout-sessions/${f.payload.id}/finish`,
          { confirmIncomplete: true },
          200,
        );
        local.status = 'aborted';
        local.endedAt = new Date().toISOString();
      }
      const input = await decision(f, id, local);
      const before = await state(f);
      await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 409);
      expect(await state(f)).toBe(before);
      await post(
        f.token,
        `/workout-session-conflicts/${id}/resolve`,
        await decision(f, id, local, 'keep_both'),
        200,
      );
    },
  );
  it('serializes two devices: exactly one decision wins, while same-key retries return the original stored result after later writes', async () => {
    const f = await fixture('race');
    const local = structuredClone(f.payload);
    local.notes = 'Local';
    const id = await open(f, local);
    const one = await decision(f, id, local, 'keep_both');
    const two = await decision(f, id, local, 'keep_remote');
    const results = await Promise.all([
      request(server())
        .post(`/api/v1/workout-session-conflicts/${id}/resolve`)
        .set('Authorization', `Bearer ${f.token}`)
        .send(one),
      request(server())
        .post(`/api/v1/workout-session-conflicts/${id}/resolve`)
        .set('Authorization', `Bearer ${f.token}`)
        .send(two),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    const index = results.findIndex((row) => row.status === 200);
    const input = index === 0 ? one : two;
    expect(await db.workoutSessionResolution.count({ where: { conflictId: id } })).toBe(1);
    expect(
      await db.workoutSessionVariant.count({ where: { workoutSessionId: f.payload.id } }),
    ).toBe(2);
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
      { comment: 'Depois do recibo' },
      200,
    );
    const retries = await Promise.all([
      post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200),
      post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200),
    ]);
    expect(retries[0]!.body).toEqual(results[index]!.body);
    expect(retries[1]!.body).toEqual(results[index]!.body);
    await post(
      f.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, choice: 'keep_local' },
      409,
    );
  });
  it('rolls back all effects when receipt insertion fails AFTER applying the decision', async () => {
    const f = await fixture('rollback');
    const local = structuredClone(f.payload);
    local.notes = 'Deve reverter';
    local.performedSets[0]!.repetitions = 13;
    const id = await open(f, local);
    const input = await decision(f, id, local);
    const before = await state(f);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION meutreino.recovery03_test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${input.idempotencyKey}'::uuid THEN RAISE EXCEPTION 'injected receipt failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER recovery03_test_receipt_failure BEFORE INSERT ON meutreino.workout_session_resolutions FOR EACH ROW EXECUTE FUNCTION meutreino.recovery03_test_receipt_failure()',
    );
    try {
      await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 500);
      expect(await state(f)).toBe(before);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER recovery03_test_receipt_failure ON meutreino.workout_session_resolutions',
      );
      await db.$executeRawUnsafe('DROP FUNCTION meutreino.recovery03_test_receipt_failure()');
    }
    await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
  });
  it('rejects stale preview and duplicate feedback targets without partial mutation', async () => {
    const f = await fixture('stale');
    const id = await open(f);
    const input = await decision(f, id, f.payload);
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/exercises/${f.payload.exerciseSessions[0]!.id}/feedback`,
      { comment: 'Mudou' },
      200,
    );
    const before = await state(f);
    await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 409);
    expect(await state(f)).toBe(before);
    const feedback = {
      id: randomUUID(),
      exerciseSessionId: f.payload.exerciseSessions[0]!.id,
      version: 0,
      perceivedLevel: 3,
      comment: null,
    };
    await post(
      f.token,
      `/workout-session-conflicts/${id}/preview`,
      {
        choice: 'keep_both',
        localRevision: 1,
        payload: { ...f.payload, feedback: [feedback, { ...feedback, id: randomUUID() }] },
      },
      400,
    );
    expect(await state(f)).toBe(before);
  });
  it('validates every external reference during preview and commit, including another owned session', async () => {
    const a = await fixture('owner');
    const b = await fixture('foreign');
    const id = await open(a);
    const input = await decision(a, id, a.payload, 'keep_both');
    const before = await state(a);
    await post(b.token, `/workout-session-conflicts/${id}/resolve`, input, 404);
    await get(b, `/workout-sessions/${a.payload.id}/variants`).expect(404);
    const foreign = structuredClone(a.payload);
    foreign.performedSets = [b.payload.performedSets[0]!];
    await post(
      a.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, payload: foreign },
      400,
    );
    const correction = structuredClone(a.payload);
    correction.corrections = [
      {
        id: randomUUID(),
        performedSetId: b.payload.performedSets[0]!.id,
        repetitions: 3,
        load: null,
        loadUnit: null,
        voided: false,
        reason: 'Ataque',
        createdAt: new Date().toISOString(),
      },
    ];
    await post(
      a.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, payload: correction },
      400,
    );
    const feedback = structuredClone(a.payload);
    feedback.feedback = [
      {
        id: randomUUID(),
        exerciseSessionId: b.payload.exerciseSessions[0]!.id,
        version: 0,
        perceivedLevel: 3,
        comment: 'Externo',
      },
    ];
    await post(
      a.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, payload: feedback },
      400,
    );
    await post(
      a.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, payload: { ...a.payload, id: randomUUID() } },
      400,
    );
    await post(
      a.token,
      `/workout-sessions/${a.payload.id}/finish`,
      { confirmIncomplete: true },
      200,
    );
    const next = await post(a.token, '/workout-sessions', { planId: a.payload.planId }, 201);
    const ownOther = structuredClone(a.payload);
    ownOther.performedSets = [
      {
        ...a.payload.performedSets[0]!,
        id: randomUUID(),
        exerciseSessionId: next.body.payload.exerciseSessions[0].id as string,
      },
    ];
    const beforeOwnOther = await state(a);
    await post(
      a.token,
      `/workout-session-conflicts/${id}/resolve`,
      { ...input, payload: ownOther },
      400,
    );
    expect(await state(a)).toBe(beforeOwnOther);
    expect(before).not.toBe(beforeOwnOther);
  });
  it('rejects an outdated feedback version even with the CURRENT session version, and does not apply partial notes', async () => {
    const f = await fixture('feedback_version');
    const id = await open(f);
    const downloaded = await current(f);
    const local = sessionSyncPayloadSchema.parse(downloaded.payload);
    local.feedback[0]!.version = 0;
    local.feedback[0]!.comment = 'Avaliação antiga';
    local.notes = 'Não aplicar';
    const before = await current(f);
    const op = operation(local, downloaded.version as number);
    const response = await post(f.token, '/sync', { operations: [op] }, 201);
    expect(response.body.results[0]).toMatchObject({
      status: 'conflict',
      code: 'feedback_diverged',
    });
    expect((await current(f)).payload).toEqual(before.payload);
    expect(await db.workoutSessionConflict.count({ where: { id, status: 'open' } })).toBe(1);
  });
  it('keep_local supports completed exercises and cancellation without changing the frozen plan version', async () => {
    const f = await fixture('cancel');
    const local = structuredClone(f.payload);
    local.status = 'aborted';
    local.endedAt = new Date().toISOString();
    local.exerciseSessions[0]!.status = 'completed';
    const id = await open(f, local);
    const input = await decision(f, id, local);
    const resolved = await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    expect(resolved.body.payload.status).toBe('aborted');
    expect(resolved.body.payload.exerciseSessions[0].status).toBe('completed');
    expect(resolved.body.payload.planVersion).toBe(f.payload.planVersion);
  });
  it('keeps the selected local effective value using a NEW correction after a more recent remote correction', async () => {
    const f = await fixture('correction_order');
    const local = structuredClone(f.payload);
    const id = await open(f, local);
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/sets/${f.payload.performedSets[0]!.id}/correct`,
      { id: randomUUID(), repetitions: 15, reason: 'Outro aparelho' },
      200,
    );
    const input = await decision(f, id, local);
    await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 200);
    const corrections = await db.performedSetCorrection.findMany({
      where: { performedSetId: f.payload.performedSets[0]!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(corrections).toHaveLength(2);
    expect(corrections[0]!.performedRepetitions).toBe(15);
    expect(corrections[1]!.performedRepetitions).toBe(8);
  });
  it('does not finalize before a confirmed remote-only set, preserving the open conflict', async () => {
    const f = await fixture('late_set');
    const local = structuredClone(f.payload);
    local.status = 'completed';
    local.endedAt = new Date().toISOString();
    await post(
      f.token,
      `/workout-sessions/${f.payload.id}/sets`,
      { id: randomUUID(), exerciseSessionId: f.payload.exerciseSessions[0]!.id, repetitions: 6 },
      200,
    );
    const id = await open(f, local);
    const input = await decision(f, id, local);
    const before = await state(f);
    await post(f.token, `/workout-session-conflicts/${id}/resolve`, input, 409);
    expect(await state(f)).toBe(before);
  });
});
