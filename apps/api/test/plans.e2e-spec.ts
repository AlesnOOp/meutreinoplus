import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonString, planSyncPayloadSchema } from '@meutreino/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DeletionService } from '../src/identity/deletion.service';
import { PrismaService } from '../src/prisma/prisma.service';

const LEG_PRESS = '10000000-0000-4000-8000-000000000002';
const SQUAT = '10000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);

describe('Workout plans API', () => {
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

  it('keeps previous rows and creates plan objects only in meutreino', async () => {
    const rows = await prisma.$queryRaw<
      { users: number; exercises: number; public_plans: boolean }[]
    >`
      SELECT
        (SELECT count(*)::int FROM meutreino.users) AS users,
        (SELECT count(*)::int FROM meutreino.exercises) AS exercises,
        EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'workout_plans'
        ) AS public_plans`;
    expect(rows[0]?.users).toBeGreaterThanOrEqual(57);
    expect(rows[0]?.exercises).toBeGreaterThanOrEqual(12);
    expect(rows[0]?.public_plans).toBe(false);
  });

  it('creates, edits, duplicates, archives and restores a plan', async () => {
    const owner = await signIn('Ficha');
    const created = await request(server())
      .post('/api/v1/workout-plans')
      .set(bearer(owner.token))
      .send({ name: 'Treino A', description: 'Configuração de exemplo', accent: 'blue' })
      .expect(201);
    expect(created.body.version).toBe(1);
    expect(created.body.exercises).toEqual([]);
    const edited = await request(server())
      .patch(`/api/v1/workout-plans/${created.body.id}`)
      .set(bearer(owner.token))
      .send({ name: 'Treino B', description: null, accent: 'green', baseVersion: 1 })
      .expect(200);
    expect(edited.body.name).toBe('Treino B');
    expect(edited.body.version).toBe(2);
    const copy = await request(server())
      .post(`/api/v1/workout-plans/${created.body.id}/duplicate`)
      .set(bearer(owner.token))
      .expect(201);
    expect(copy.body.id).not.toBe(created.body.id);
    expect(copy.body.name).toBe('Treino B (cópia)');
    expect(copy.body.version).toBe(1);
    const archived = await request(server())
      .post(`/api/v1/workout-plans/${created.body.id}/archive`)
      .set(bearer(owner.token))
      .send({ baseVersion: 2 })
      .expect(200);
    expect(archived.body.status).toBe('archived');
    const hidden = await request(server())
      .get('/api/v1/workout-plans')
      .set(bearer(owner.token))
      .expect(200);
    expect(hidden.body.items.some((item: { id: string }) => item.id === created.body.id)).toBe(
      false,
    );
    const restored = await request(server())
      .post(`/api/v1/workout-plans/${created.body.id}/restore`)
      .set(bearer(owner.token))
      .send({ baseVersion: archived.body.version })
      .expect(200);
    expect(restored.body.status).toBe('active');
  });

  it('adds the same exercise twice, reorders, removes and replaces sets explicitly', async () => {
    const owner = await signIn('Ordem');
    const plan = await createPlan(owner.token, 'Superiores');
    const first = await addExercise(owner.token, plan, LEG_PRESS);
    const second = await addExercise(owner.token, first.version, plan.id, SQUAT);
    const repeated = await addExercise(owner.token, second.version, plan.id, LEG_PRESS);
    const legPressRows = repeated.exercises.filter(
      (item: { exerciseId: string }) => item.exerciseId === LEG_PRESS,
    );
    expect(legPressRows).toHaveLength(2);
    const ordered = [repeated.exercises[1].id, repeated.exercises[2].id, repeated.exercises[0].id];
    const reordered = await request(server())
      .put(`/api/v1/workout-plans/${plan.id}/exercises/order`)
      .set(bearer(owner.token))
      .send({ baseVersion: repeated.version, orderedIds: ordered })
      .expect(200);
    expect(reordered.body.exercises.map((item: { id: string }) => item.id)).toEqual(ordered);
    const removed = await request(server())
      .delete(`/api/v1/workout-plans/${plan.id}/exercises/${ordered[2]}`)
      .set(bearer(owner.token))
      .send({ baseVersion: reordered.body.version })
      .expect(200);
    expect(removed.body.exercises).toHaveLength(2);
    const previous = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}/revisions/1`)
      .set(bearer(owner.token))
      .expect(200);
    expect(previous.body.snapshot.exercises).toEqual([]);
    const kept = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${ordered[0]}/replace`)
      .set(bearer(owner.token))
      .send({ baseVersion: removed.body.version, exerciseId: SQUAT, preserveSets: true })
      .expect(200);
    const reset = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${ordered[1]}/replace`)
      .set(bearer(owner.token))
      .send({ baseVersion: kept.body.version, exerciseId: LEG_PRESS, preserveSets: false })
      .expect(200);
    const resetExercise = reset.body.exercises.find(
      (item: { id: string }) => item.id === ordered[1],
    );
    expect(resetExercise.exerciseId).toBe(LEG_PRESS);
    expect(resetExercise.sets).toHaveLength(1);
    expect(resetExercise.sets[0].load).toBeNull();
  });

  it('stores fixed, variable and absent loads and converts pounds once', async () => {
    const owner = await signIn('Carga');
    const plan = await createPlan(owner.token, 'Inferiores');
    const withExercise = await addExercise(owner.token, plan, LEG_PRESS);
    const exerciseId = withExercise.exercises[0].id;
    let version = withExercise.version;
    const loads = [
      { repetitions: 12, load: '80', loadUnit: 'kg', loadType: 'fixed' },
      { repetitions: 10, load: '100', loadUnit: 'kg', loadType: 'progressive' },
      { repetitions: 8, load: '120', loadUnit: 'kg', loadType: 'progressive' },
      { repetitions: 8, load: '120', loadUnit: 'kg', loadType: 'progressive' },
    ];
    let last: PlanBody | null = null;
    for (const load of loads) {
      const response = await request(server())
        .post(`/api/v1/workout-plans/${plan.id}/exercises/${exerciseId}/sets`)
        .set(bearer(owner.token))
        .send({ ...load, restSeconds: 90, baseVersion: version, kind: 'normal' })
        .expect(201);
      version = response.body.version;
      last = response.body;
    }
    const sets = last?.exercises[0].sets ?? [];
    expect(sets.map((set) => [set.repetitions, set.load])).toEqual([
      [12, '80.00'],
      [10, '100.00'],
      [8, '120.00'],
      [8, '120.00'],
    ]);
    const duplicated = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${exerciseId}/sets/${sets[3].id}/duplicate`)
      .set(bearer(owner.token))
      .send({ baseVersion: version })
      .expect(201);
    expect(duplicated.body.exercises[0].sets).toHaveLength(5);
    expect(duplicated.body.exercises[0].sets[4].load).toBe('120.00');
    const pounds = await request(server())
      .patch(`/api/v1/workout-plans/${plan.id}/exercises/${exerciseId}/sets/${sets[0].id}`)
      .set(bearer(owner.token))
      .send({
        baseVersion: duplicated.body.version,
        repetitions: 12,
        load: '100',
        loadUnit: 'lb',
        loadType: 'fixed',
        restSeconds: 90,
        kind: 'normal',
      })
      .expect(200);
    const converted = pounds.body.exercises[0].sets[0];
    expect(converted.load).toBe('100.00');
    expect(converted.loadUnit).toBe('lb');
    const stored = await prisma.workoutPlanSet.findUniqueOrThrow({ where: { id: sets[0].id } });
    expect(stored.targetLoad?.toFixed(2)).toBe('100.00');
    expect(stored.targetLoadKg?.toFixed(2)).toBe('45.36');
    const bodyweight = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises`)
      .set(bearer(owner.token))
      .send({
        baseVersion: pounds.body.version,
        exerciseId: SQUAT,
        restSeconds: null,
        sets: [
          {
            id: randomUUID(),
            setIndex: 1,
            kind: 'warmup',
            repetitions: 15,
            load: null,
            loadUnit: 'kg',
            loadType: 'bodyweight',
            restSeconds: 60,
          },
        ],
      })
      .expect(201);
    const openSet = bodyweight.body.exercises.find(
      (item: { exerciseId: string }) => item.exerciseId === SQUAT,
    ).sets[0];
    expect(openSet.load).toBeNull();
    const row = await prisma.workoutPlanSet.findUniqueOrThrow({ where: { id: openSet.id } });
    expect(row.targetLoad).toBeNull();
    expect(row.targetLoadKg).toBeNull();
    await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises/${exerciseId}/sets`)
      .set(bearer(owner.token))
      .send({
        baseVersion: bodyweight.body.version,
        repetitions: -1,
        load: '10',
        loadUnit: 'kg',
        loadType: 'fixed',
        restSeconds: 60,
      })
      .expect(400);
  });

  it('keeps a plan when the preferred machine is archived', async () => {
    const owner = await signIn('Maquina');
    const gym = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Academia Centro' })
      .expect(201);
    const otherGym = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Academia Shopping' })
      .expect(201);
    const machine = await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({ name: 'Leg press', machineNumber: '32' })
      .expect(201);
    const otherMachine = await request(server())
      .post(`/api/v1/gyms/${otherGym.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({ name: 'Leg press', machineNumber: '08' })
      .expect(201);
    const plan = await createPlan(owner.token, 'Treino A');
    const added = await request(server())
      .post(`/api/v1/workout-plans/${plan.id}/exercises`)
      .set(bearer(owner.token))
      .send({
        baseVersion: plan.version,
        exerciseId: LEG_PRESS,
        restSeconds: 90,
        notes: 'Configuração de exemplo, não é recomendação.',
        equipment: [
          { gymId: gym.body.id, equipmentId: machine.body.id },
          { gymId: otherGym.body.id, equipmentId: otherMachine.body.id },
        ],
      })
      .expect(201);
    expect(added.body.exercises[0].equipment).toHaveLength(2);
    await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment/${machine.body.id}/archive`)
      .set(bearer(owner.token))
      .expect(201);
    const read = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .expect(200);
    const preference = read.body.exercises[0].equipment.find(
      (item: { gymId: string }) => item.gymId === gym.body.id,
    );
    expect(preference.machineNumber).toBe('32');
    expect(preference.equipmentStatus).toBe('archived');
    const shopping = read.body.exercises[0].equipment.find(
      (item: { gymId: string }) => item.gymId === otherGym.body.id,
    );
    expect(shopping.machineNumber).toBe('08');
  });

  it('hides plans from another user and rejects a stale version', async () => {
    const owner = await signIn('Dono');
    const other = await signIn('Vizinho');
    const plan = await createPlan(owner.token, 'Full Body');
    await request(server())
      .get(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(other.token))
      .expect(404);
    await request(server())
      .patch(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .send({ name: 'Full Body', description: null, accent: null, baseVersion: 4 })
      .expect(409);
    const revisions = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}/revisions`)
      .set(bearer(owner.token))
      .expect(200);
    expect(revisions.body.items).toHaveLength(1);
  });

  it('preserves both plan versions when synchronization diverges', async () => {
    const owner = await signIn('Sync');
    const plan = await createPlan(owner.token, 'Treino A');
    const payload = {
      id: plan.id,
      name: 'Treino A local',
      description: null,
      accent: 'amber' as const,
      status: 'active' as const,
      exercises: [] as [],
    };
    const operation = syncOperation(payload, null);
    const conflict = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(conflict.body.results[0]).toMatchObject({
      status: 'conflict',
      code: 'version_mismatch',
    });
    const retry = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(retry.body.results[0].status).toBe('conflict');
    const unchanged = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .expect(200);
    expect(unchanged.body.name).toBe('Treino A');
    expect(unchanged.body.version).toBe(1);
    const both = await request(server())
      .post(`/api/v1/workout-plan-conflicts/${operation.id}/resolve`)
      .set(bearer(owner.token))
      .send({ choice: 'keep_both' })
      .expect(200);
    expect(both.body.plan.name).toBe('Treino A');
    expect(both.body.preservedPlan.name).toBe('Treino A local (cópia)');
    const second = syncOperation({ ...payload, name: 'Treino A deste aparelho' }, 1, randomUUID());
    await request(server())
      .patch(`/api/v1/workout-plans/${plan.id}`)
      .set(bearer(owner.token))
      .send({ name: 'Treino A servidor', description: null, accent: null, baseVersion: 1 })
      .expect(200);
    const again = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [second] })
      .expect(201);
    expect(again.body.results[0].status).toBe('conflict');
    const kept = await request(server())
      .post(`/api/v1/workout-plan-conflicts/${second.id}/resolve`)
      .set(bearer(owner.token))
      .send({ choice: 'keep_local', payload: { ...payload, name: 'Treino A deste aparelho' } })
      .expect(200);
    expect(kept.body.plan.name).toBe('Treino A deste aparelho');
    expect(kept.body.plan.version).toBe(3);
    const history = await request(server())
      .get(`/api/v1/workout-plans/${plan.id}/revisions/2`)
      .set(bearer(owner.token))
      .expect(200);
    expect(history.body.snapshot.name).toBe('Treino A servidor');
    const freshId = randomUUID();
    const createOperation = syncOperation(
      {
        id: freshId,
        name: 'Offline',
        description: null,
        accent: null,
        status: 'active',
        exercises: [],
      },
      null,
    );
    const applied = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [createOperation] })
      .expect(201);
    expect(applied.body.results[0].status).toBe('applied');
    const duplicate = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [createOperation] })
      .expect(201);
    expect(duplicate.body.results[0].status).toBe('applied');
    const created = await prisma.workoutPlan.count({ where: { id: freshId } });
    expect(created).toBe(1);
  });

  async function signIn(name: string): Promise<{ token: string; userId: string }> {
    const email = `plans-${randomUUID()}@example.com`;
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

  async function createPlan(token: string, name: string): Promise<PlanBody> {
    const response = await request(server())
      .post('/api/v1/workout-plans')
      .set(bearer(token))
      .send({ name })
      .expect(201);
    return response.body as PlanBody;
  }

  async function addExercise(
    token: string,
    planOrVersion: PlanBody | number,
    planIdOrExercise: string,
    exerciseId?: string,
    restSeconds?: number,
  ): Promise<PlanBody> {
    const version = typeof planOrVersion === 'number' ? planOrVersion : planOrVersion.version;
    const planId = typeof planOrVersion === 'number' ? planIdOrExercise : planOrVersion.id;
    const selected = typeof planOrVersion === 'number' ? exerciseId : planIdOrExercise;
    const response = await request(server())
      .post(`/api/v1/workout-plans/${planId}/exercises`)
      .set(bearer(token))
      .send({ baseVersion: version, exerciseId: selected, restSeconds: restSeconds ?? null })
      .expect(201);
    return response.body as PlanBody;
  }

  function server(): App {
    return app.getHttpServer() as App;
  }
});

type PlanBody = {
  id: string;
  version: number;
  exercises: Array<{
    id: string;
    exerciseId: string;
    sets: Array<{ id: string; repetitions: number | null; load: string | null }>;
  }>;
};

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function syncOperation(
  payload: {
    id: string;
    name: string;
    description: string | null;
    accent: string | null;
    status: 'active' | 'archived';
    exercises: [];
  },
  baseVersion: number | null,
  idempotencyKey = randomUUID(),
) {
  const value = JSON.parse(JSON.stringify(planSyncPayloadSchema.parse(payload))) as { id: string };
  return {
    id: randomUUID(),
    entityType: 'workout_plan',
    entityId: value.id,
    operation: 'upsert',
    idempotencyKey,
    payloadHash: createHash('sha256').update(canonicalJsonString(value)).digest('hex'),
    baseVersion,
    createdAt: new Date().toISOString(),
    payload: value,
  };
}
