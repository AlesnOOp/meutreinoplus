import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJsonString,
  equipmentSyncPayloadSchema,
  exerciseSyncPayloadSchema,
  gymSyncPayloadSchema,
} from '@meutreino/shared';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DeletionService } from '../src/identity/deletion.service';
import { PrismaService } from '../src/prisma/prisma.service';

const LEG_PRESS = '10000000-0000-4000-8000-000000000002';
const SQUAT = '10000000-0000-4000-8000-000000000001';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNwa9ryHwAFCgJ8H5wcvwAAAABJRU5ErkJggg==';

type SyncBody = {
  id: string;
  entityType: 'gym' | 'equipment' | 'exercise';
  entityId: string;
  operation: 'upsert';
  idempotencyKey: string;
  payloadHash: string;
  baseVersion: number | null;
  createdAt: string;
  payload: unknown;
};

jest.setTimeout(120_000);

describe('Catalog API', () => {
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

  it('keeps business tables in meutreino and the seeded library', async () => {
    const rows = await prisma.$queryRaw<
      { database_name: string; users_table: boolean; public_users: boolean; migrations: boolean }[]
    >`SELECT current_database() AS database_name,
             EXISTS (
               SELECT 1 FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'meutreino' AND c.relname = 'users'
             ) AS users_table,
             EXISTS (
               SELECT 1 FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'users'
             ) AS public_users,
             EXISTS (
               SELECT 1 FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations'
             ) AS migrations`;
    expect(rows[0]?.database_name).toBe('meutreino');
    expect(rows[0]?.users_table).toBe(true);
    expect(rows[0]?.public_users).toBe(false);
    expect(rows[0]?.migrations).toBe(true);
    const exercise = await prisma.exercise.findUniqueOrThrow({ where: { id: SQUAT } });
    expect(exercise.origin).toBe('system');
    expect(exercise.ownerUserId).toBeNull();
  });

  it('isolates gyms, keeps one preferred gym, and archives without deleting equipment', async () => {
    const owner = await signIn('Dona');
    const other = await signIn('Outra');
    const first = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Unidade Centro', city: 'São Paulo', isPreferred: true })
      .expect(201);
    const second = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Unidade Jardins', branchName: 'Jardins', isPreferred: true })
      .expect(201);
    expect(second.body.isPreferred).toBe(true);
    const listed = await request(server()).get('/api/v1/gyms').set(bearer(owner.token)).expect(200);
    const previous = listed.body.items.find((item: { id: string }) => item.id === first.body.id);
    expect(previous.isPreferred).toBe(false);
    expect(
      listed.body.items.filter((item: { isPreferred: boolean }) => item.isPreferred),
    ).toHaveLength(1);

    const machine = await request(server())
      .post(`/api/v1/gyms/${first.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({
        name: 'Leg Press 45°',
        machineNumber: '32',
        notes: 'Máquina próxima à janela.',
        exerciseIds: [LEG_PRESS],
      })
      .expect(201);
    const withoutNumber = await request(server())
      .post(`/api/v1/gyms/${second.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({ name: 'Leg Press 45°', machineNumber: '32', exerciseIds: [LEG_PRESS] })
      .expect(201);
    expect(withoutNumber.body.machineNumber).toBe('32');
    expect(withoutNumber.body.gymId).not.toBe(machine.body.gymId);
    const unnumbered = await request(server())
      .post(`/api/v1/gyms/${first.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({ name: 'Colchonete', exerciseIds: [] })
      .expect(201);
    expect(unnumbered.body.machineNumber).toBeNull();

    await request(server())
      .get(`/api/v1/gyms/${first.body.id}`)
      .set(bearer(other.token))
      .expect(404);
    await request(server())
      .get(`/api/v1/gyms/${first.body.id}/equipment/${machine.body.id}`)
      .set(bearer(other.token))
      .expect(404);
    await request(server())
      .post(`/api/v1/gyms/${first.body.id}/archive`)
      .set(bearer(owner.token))
      .expect(201);
    const archivedEquipment = await request(server())
      .get(`/api/v1/gyms/${first.body.id}/equipment/${machine.body.id}`)
      .set(bearer(owner.token))
      .expect(200);
    expect(archivedEquipment.body.exerciseIds).toEqual([LEG_PRESS]);
    const stored = await prisma.equipment.count({ where: { id: machine.body.id } });
    expect(stored).toBe(1);
  });

  it('stores a private photo and blocks another user', async () => {
    const owner = await signIn('Foto');
    const other = await signIn('Intrusa');
    const gym = await request(server())
      .post('/api/v1/gyms')
      .set(bearer(owner.token))
      .send({ name: 'Academia da foto' })
      .expect(201);
    const equipment = await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment`)
      .set(bearer(owner.token))
      .send({ name: 'Supino' })
      .expect(201);
    await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .send({
        contentType: 'image/png',
        dataBase64: Buffer.from('not-an-image').toString('base64'),
      })
      .expect(400);
    await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .send({
        contentType: 'image/png',
        dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
      })
      .expect(400);
    await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .send({ contentType: 'image/png', dataBase64: PNG })
      .expect(204);
    const beforeRetry = await prisma.equipment.findUniqueOrThrow({
      where: { id: equipment.body.id },
    });
    const mediaBefore = await prisma.mediaAsset.count({
      where: { ownerUserId: owner.userId, kind: 'equipment_photo' },
    });
    // The first commit may have succeeded even if the device lost its ACK.
    await Promise.all(
      [1, 2].map(() =>
        request(server())
          .post(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
          .set(bearer(owner.token))
          .send({ contentType: 'image/png', dataBase64: PNG })
          .expect(204),
      ),
    );
    const afterRetry = await prisma.equipment.findUniqueOrThrow({
      where: { id: equipment.body.id },
    });
    expect(afterRetry.photoAssetId).toBe(beforeRetry.photoAssetId);
    expect(afterRetry.version).toBe(beforeRetry.version);
    expect(
      await prisma.mediaAsset.count({
        where: { ownerUserId: owner.userId, kind: 'equipment_photo' },
      }),
    ).toBe(mediaBefore);
    await request(server())
      .post(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(other.token))
      .send({ contentType: 'image/png', dataBase64: PNG })
      .expect(404);
    const download = await request(server())
      .get(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .expect(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(Buffer.from(download.body as Uint8Array).equals(Buffer.from(PNG, 'base64'))).toBe(true);
    await request(server())
      .get(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(other.token))
      .expect(404);
    await request(server())
      .delete(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .expect(204);
    await request(server())
      .get(`/api/v1/gyms/${gym.body.id}/equipment/${equipment.body.id}/photo`)
      .set(bearer(owner.token))
      .expect(404);
  });

  it('searches the library, accepts custom exercises, and rejects edits to system exercises', async () => {
    const owner = await signIn('Biblioteca');
    const found = await request(server())
      .get('/api/v1/exercises')
      .query({ q: 'Agachamento', muscle: 'quadriceps', equipmentType: 'barbell' })
      .set(bearer(owner.token))
      .expect(200);
    expect(found.body.items.some((item: { id: string }) => item.id === SQUAT)).toBe(true);
    expect(found.body.items.every((item: { editable: boolean }) => item.editable === false)).toBe(
      true,
    );
    await request(server())
      .patch(`/api/v1/exercises/${SQUAT}`)
      .set(bearer(owner.token))
      .send(exerciseBody('Agachamento alterado'))
      .expect(403);
    const created = await request(server())
      .post('/api/v1/exercises')
      .set(bearer(owner.token))
      .send(exerciseBody('Meu agachamento'))
      .expect(201);
    expect(created.body.origin).toBe('user');
    expect(created.body.editable).toBe(true);
    const updated = await request(server())
      .patch(`/api/v1/exercises/${created.body.id}`)
      .set(bearer(owner.token))
      .send(exerciseBody('Meu agachamento lento'))
      .expect(200);
    expect(updated.body.namePt).toBe('Meu agachamento lento');
    await request(server())
      .post(`/api/v1/exercises/${created.body.id}/archive`)
      .set(bearer(owner.token))
      .expect(201);
    const hidden = await request(server())
      .get('/api/v1/exercises')
      .query({ q: 'Meu agachamento lento' })
      .set(bearer(owner.token))
      .expect(200);
    expect(hidden.body.items).toHaveLength(0);
    const archived = await request(server())
      .get('/api/v1/exercises')
      .query({ q: 'Meu agachamento lento', includeArchived: 'true' })
      .set(bearer(owner.token))
      .expect(200);
    expect(archived.body.items[0].status).toBe('archived');
  });

  it('applies idempotent sync, reports conflicts, and refuses system catalog writes', async () => {
    const owner = await signIn('Sync');
    const other = await signIn('Sync outra');
    const gymId = randomUUID();
    const operation = syncOperation(
      gymSyncPayloadSchema,
      'gym',
      {
        id: gymId,
        name: 'Academia offline',
        isPreferred: true,
        status: 'active',
      },
      null,
    );
    const first = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(first.body.results[0].status).toBe('applied');
    const retry = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [operation] })
      .expect(201);
    expect(retry.body.results[0].status).toBe('applied');
    expect(await prisma.gym.count({ where: { id: gymId } })).toBe(1);
    const changedKey = syncOperation(
      gymSyncPayloadSchema,
      'gym',
      {
        id: gymId,
        name: 'Nome diferente',
        isPreferred: true,
        status: 'active',
      },
      1,
      operation.idempotencyKey,
    );
    const reused = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [changedKey] })
      .expect(201);
    expect(reused.body.results[0]).toMatchObject({
      status: 'rejected',
      code: 'idempotency_key_reused',
    });
    await request(server())
      .patch(`/api/v1/gyms/${gymId}`)
      .set(bearer(owner.token))
      .send({ name: 'Academia no servidor', isPreferred: true })
      .expect(200);
    const stale = syncOperation(
      gymSyncPayloadSchema,
      'gym',
      {
        id: gymId,
        name: 'Academia antiga',
        isPreferred: true,
        status: 'active',
      },
      1,
    );
    const conflict = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [stale] })
      .expect(201);
    expect(conflict.body.results[0].status).toBe('conflict');
    const conflictRetry = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [stale] })
      .expect(201);
    expect(conflictRetry.body.results[0].status).toBe('conflict');
    const current = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
    expect(current.name).toBe('Academia no servidor');

    const stolen = syncOperation(
      gymSyncPayloadSchema,
      'gym',
      {
        id: gymId,
        name: 'Não é sua',
        status: 'active',
      },
      current.version,
    );
    await request(server())
      .post('/api/v1/sync')
      .set(bearer(other.token))
      .send({ operations: [stolen] })
      .expect(404);

    const systemWrite = syncOperation(
      exerciseSyncPayloadSchema,
      'exercise',
      {
        id: SQUAT,
        ...exerciseBody('Agachamento pirateado'),
        status: 'active',
      },
      1,
    );
    const rejected = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [systemWrite] })
      .expect(201);
    expect(rejected.body.results[0]).toMatchObject({
      status: 'rejected',
      code: 'server_authoritative',
    });

    const equipmentId = randomUUID();
    const equipmentSync = syncOperation(
      equipmentSyncPayloadSchema,
      'equipment',
      {
        id: equipmentId,
        gymId,
        name: 'Crossover',
        machineNumber: null,
        exerciseIds: [LEG_PRESS],
        status: 'active',
      },
      null,
    );
    const linked = await request(server())
      .post('/api/v1/sync')
      .set(bearer(owner.token))
      .send({ operations: [equipmentSync] })
      .expect(201);
    expect(linked.body.results[0].status).toBe('applied');
    const snapshot = await request(server())
      .get('/api/v1/sync/snapshot')
      .set(bearer(owner.token))
      .expect(200);
    expect(
      snapshot.body.equipment.some(
        (item: { id: string; exerciseIds: string[] }) =>
          item.id === equipmentId && item.exerciseIds.includes(LEG_PRESS),
      ),
    ).toBe(true);
    expect(snapshot.body.exercises.some((item: { id: string }) => item.id === SQUAT)).toBe(true);
  });

  async function signIn(name: string): Promise<{ token: string; userId: string }> {
    const email = `catalog-${randomUUID()}@example.com`;
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

  function server(): App {
    return app.getHttpServer() as App;
  }
});

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function exerciseBody(namePt: string) {
  return {
    namePt,
    activityType: 'strength',
    description: 'Descrição própria, sem carga e sem séries.',
    instructions: 'Anote o que você fez. O aplicativo não prescreve.',
    primaryMuscle: 'quadriceps',
    secondaryMuscles: ['glutes'],
    equipmentTypes: ['bodyweight'],
  };
}

function syncOperation<T extends { id: string }>(
  schema: { parse: (value: unknown) => T },
  entityType: SyncBody['entityType'],
  payload: unknown,
  baseVersion: number | null,
  idempotencyKey: string = randomUUID(),
): SyncBody {
  const value = JSON.parse(JSON.stringify(schema.parse(payload))) as T;
  return {
    id: randomUUID(),
    entityType,
    entityId: value.id,
    operation: 'upsert',
    idempotencyKey,
    payloadHash: createHash('sha256').update(canonicalJsonString(value)).digest('hex'),
    baseVersion,
    createdAt: new Date().toISOString(),
    payload: value,
  };
}
