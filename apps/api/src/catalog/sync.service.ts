import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  canonicalJsonString,
  equipmentSyncPayloadSchema,
  evaluateSyncDecision,
  exerciseSyncPayloadSchema,
  gymSyncPayloadSchema,
  planSyncPayloadSchema,
  type SyncOperationEnvelope,
} from '@meutreino/shared';
import { sha256 } from '../identity/crypto';
import { fail } from '../identity/http';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

type PushOperation = SyncOperationEnvelope & { payload: unknown };

@Injectable()
export class SyncApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly sessions: SessionsService,
  ) {}

  async push(userId: string, sessionId: string, operations: PushOperation[]) {
    const session = await this.prisma.authSession.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session?.deviceId) {
      throw fail(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Entre novamente para continuar.');
    }
    const results = [];
    for (const operation of operations) {
      results.push(await this.apply(userId, session.deviceId, operation));
    }
    return { results };
  }

  private async apply(userId: string, deviceId: string, operation: PushOperation) {
    if (operation.entityType === 'workout_session') {
      return this.sessions.applyOperation(userId, deviceId, operation);
    }
    if (
      operation.operation === 'correct' ||
      (operation.entityType !== 'gym' &&
        operation.entityType !== 'equipment' &&
        operation.entityType !== 'exercise' &&
        operation.entityType !== 'workout_plan')
    ) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'unsupported_entity',
        'Esta entidade ainda não sincroniza.',
      );
    }
    const parsed = parsePayload(operation);
    const hash = sha256(canonicalJsonString(JSON.parse(JSON.stringify(parsed.value))));
    if (hash !== operation.payloadHash) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'payload_hash_mismatch',
        'A operação não confere com o conteúdo enviado.',
      );
    }
    const existingOperation = await this.prisma.syncOperation.findUnique({
      where: { idempotencyKey: operation.idempotencyKey },
    });
    if (existingOperation) {
      if (existingOperation.userId !== userId || existingOperation.payloadHash !== hash) {
        return { id: operation.id, status: 'rejected' as const, code: 'idempotency_key_reused' };
      }
      if (existingOperation.status === 'applied') {
        return { id: operation.id, status: 'applied' as const };
      }
      if (existingOperation.status === 'conflict') {
        return {
          id: operation.id,
          status: 'conflict' as const,
          code: existingOperation.conflictCode ?? 'version_mismatch',
        };
      }
      return {
        id: operation.id,
        status: 'rejected' as const,
        code: existingOperation.conflictCode ?? 'rejected',
      };
    }
    const current = await this.currentRecord(userId, operation.entityType, operation.entityId);
    if (current?.origin === 'other') {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Registro não encontrado.');
    }
    const decision = evaluateSyncDecision({
      domain:
        operation.entityType === 'exercise' && current?.origin === 'system'
          ? 'reference_catalog'
          : 'editable_aggregate',
      operation: operation.operation,
      payloadHash: operation.payloadHash,
      baseVersion: operation.baseVersion,
      server: current ? { version: current.version, payloadHash: null, locked: false } : null,
      existingOperation: null,
    });
    if (decision.outcome === 'reject' || decision.outcome === 'conflict') {
      const status = decision.outcome === 'conflict' ? 'conflict' : 'rejected';
      if (
        status === 'conflict' &&
        operation.entityType === 'workout_plan' &&
        parsed.kind === 'plan'
      ) {
        await this.plans.preserveConflict(
          userId,
          operation.id,
          operation.entityId,
          operation.baseVersion,
          parsed.value,
        );
      }
      await this.receipt(userId, deviceId, operation, status, decision.code);
      return { id: operation.id, status, code: decision.code };
    }
    await this.prisma.$transaction(async (tx) => {
      if (decision.outcome === 'apply') {
        await this.write(tx, userId, operation, parsed);
      }
      await tx.syncOperation.create({
        data: {
          id: operation.id,
          userId,
          deviceId,
          entityType: operation.entityType,
          entityId: operation.entityId,
          operation: operation.operation,
          idempotencyKey: operation.idempotencyKey,
          payloadHash: operation.payloadHash,
          baseVersion: operation.baseVersion,
          status: 'applied',
          appliedAt: new Date(),
        },
      });
    });
    return { id: operation.id, status: 'applied' as const };
  }

  private async currentRecord(userId: string, entityType: string, entityId: string) {
    if (entityType === 'gym') {
      return this.prisma.gym
        .findUnique({ where: { id: entityId } })
        .then((row) =>
          row && row.ownerUserId === userId
            ? { version: row.version, origin: 'user' as const }
            : row
              ? { version: row.version, origin: 'other' as const }
              : null,
        );
    }
    if (entityType === 'equipment') {
      const row = await this.prisma.equipment.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        version: row.version,
        origin: row.userId === userId ? ('user' as const) : ('other' as const),
      };
    }
    if (entityType === 'exercise') {
      const row = await this.prisma.exercise.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        version: row.version,
        origin:
          row.origin === 'system'
            ? ('system' as const)
            : row.ownerUserId === userId
              ? ('user' as const)
              : ('other' as const),
      };
    }
    if (entityType === 'workout_plan') {
      const row = await this.prisma.workoutPlan.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        version: row.version,
        origin: row.ownerUserId === userId ? ('user' as const) : ('other' as const),
      };
    }
    return null;
  }

  private async write(
    tx: PrismaTx,
    userId: string,
    operation: PushOperation,
    payload: ReturnType<typeof parsePayload>,
  ) {
    if (operation.entityType === 'gym' && payload.kind === 'gym') {
      await writeGym(tx, userId, operation.operation, payload.value);
      return;
    }
    if (operation.entityType === 'equipment' && payload.kind === 'equipment') {
      await writeEquipment(tx, userId, operation.operation, payload.value);
      return;
    }
    if (operation.entityType === 'exercise' && payload.kind === 'exercise') {
      await writeExercise(tx, userId, operation.operation, payload.value);
      return;
    }
    if (operation.entityType === 'workout_plan' && payload.kind === 'plan') {
      await this.plans.applySynced(tx, userId, operation.operation, payload.value);
      return;
    }
    throw fail(HttpStatus.BAD_REQUEST, 'unsupported_entity', 'Esta entidade ainda não sincroniza.');
  }

  private async receipt(
    userId: string,
    deviceId: string,
    operation: PushOperation,
    status: 'rejected' | 'conflict',
    code: string,
  ) {
    await this.prisma.syncOperation
      .create({
        data: {
          id: operation.id,
          userId,
          deviceId,
          entityType: operation.entityType,
          entityId: operation.entityId,
          operation: operation.operation,
          idempotencyKey: operation.idempotencyKey,
          payloadHash: operation.payloadHash,
          baseVersion: operation.baseVersion,
          status,
          conflictCode: code,
        },
      })
      .catch(() => undefined);
  }
}

type PrismaTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

function parsePayload(operation: PushOperation) {
  if (operation.entityType === 'gym') {
    return { kind: 'gym' as const, value: readPayload(gymSyncPayloadSchema, operation) };
  }
  if (operation.entityType === 'equipment') {
    return {
      kind: 'equipment' as const,
      value: readPayload(equipmentSyncPayloadSchema, operation),
    };
  }
  if (operation.entityType === 'exercise') {
    return { kind: 'exercise' as const, value: readPayload(exerciseSyncPayloadSchema, operation) };
  }
  if (operation.entityType === 'workout_plan') {
    return { kind: 'plan' as const, value: readPayload(planSyncPayloadSchema, operation) };
  }
  throw fail(HttpStatus.BAD_REQUEST, 'unsupported_entity', 'Esta entidade ainda não sincroniza.');
}

function readPayload<T extends { id: string }>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  operation: PushOperation,
): T {
  const parsed = schema.safeParse(operation.payload);
  if (!parsed.success || parsed.data.id !== operation.entityId) {
    throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'Revise os dados da operação.');
  }
  return parsed.data;
}

async function writeGym(
  tx: PrismaTx,
  userId: string,
  operation: string,
  value: ReturnType<typeof gymSyncPayloadSchema.parse>,
) {
  const existing = await tx.gym.findUnique({ where: { id: value.id } });
  if (existing && existing.ownerUserId !== userId) {
    throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
  }
  if (operation === 'delete' || value.status === 'archived') {
    if (!existing) return;
    await tx.gym.update({
      where: { id: value.id },
      data: { status: 'archived', isPreferred: false, version: { increment: 1 } },
    });
    return;
  }
  if (value.isPreferred) {
    await tx.gym.updateMany({
      where: { ownerUserId: userId, isPreferred: true },
      data: { isPreferred: false },
    });
  }
  if (!existing) {
    await tx.gym.create({
      data: {
        id: value.id,
        ownerUserId: userId,
        name: value.name,
        nickname: value.nickname ?? null,
        branchName: value.branchName ?? null,
        city: value.city ?? null,
        notes: value.notes ?? null,
        status: value.status,
        isPreferred: value.isPreferred ?? false,
        memberships: { create: { userId, role: 'owner' } },
      },
    });
    return;
  }
  await tx.gym.update({
    where: { id: value.id },
    data: {
      name: value.name,
      nickname: value.nickname ?? null,
      branchName: value.branchName ?? null,
      city: value.city ?? null,
      notes: value.notes ?? null,
      status: value.status,
      isPreferred: value.isPreferred ?? false,
      version: { increment: 1 },
    },
  });
}

async function writeEquipment(
  tx: PrismaTx,
  userId: string,
  operation: string,
  value: ReturnType<typeof equipmentSyncPayloadSchema.parse>,
) {
  const gym = await tx.gym.findFirst({ where: { id: value.gymId, ownerUserId: userId } });
  if (!gym) {
    throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
  }
  const existing = await tx.equipment.findUnique({ where: { id: value.id } });
  if (existing && (existing.userId !== userId || existing.gymId !== value.gymId)) {
    throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Equipamento não encontrado.');
  }
  if (operation === 'delete' || value.status === 'archived') {
    if (!existing) return;
    await tx.equipment.update({
      where: { id: value.id },
      data: { status: 'archived', version: { increment: 1 } },
    });
    return;
  }
  const exerciseIds = value.exerciseIds ?? [];
  if (exerciseIds.length > 0) {
    const visible = await tx.exercise.count({
      where: {
        id: { in: exerciseIds },
        OR: [{ origin: 'system' }, { origin: 'user', ownerUserId: userId }],
      },
    });
    if (visible !== new Set(exerciseIds).size) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
    }
  }
  if (!existing) {
    await tx.equipment.create({
      data: {
        id: value.id,
        userId,
        gymId: value.gymId,
        name: value.name,
        machineNumber: value.machineNumber ?? null,
        nickname: value.nickname ?? null,
        notes: value.notes ?? null,
        status: value.status,
        exerciseLinks: { create: exerciseIds.map((exerciseId) => ({ exerciseId })) },
      },
    });
    return;
  }
  await tx.equipmentExerciseLink.deleteMany({ where: { equipmentId: value.id } });
  await tx.equipment.update({
    where: { id: value.id },
    data: {
      name: value.name,
      machineNumber: value.machineNumber ?? null,
      nickname: value.nickname ?? null,
      notes: value.notes ?? null,
      status: value.status,
      version: { increment: 1 },
      exerciseLinks: { create: exerciseIds.map((exerciseId) => ({ exerciseId })) },
    },
  });
}

async function writeExercise(
  tx: PrismaTx,
  userId: string,
  operation: string,
  value: ReturnType<typeof exerciseSyncPayloadSchema.parse>,
) {
  const existing = await tx.exercise.findUnique({ where: { id: value.id } });
  if (existing?.origin === 'system' || (existing && existing.ownerUserId !== userId)) {
    throw fail(
      HttpStatus.FORBIDDEN,
      'system_exercise',
      'Exercícios da biblioteca geral não podem ser editados.',
    );
  }
  if (operation === 'delete' || value.status === 'archived') {
    if (!existing) return;
    await tx.exercise.update({
      where: { id: value.id },
      data: { status: 'archived', version: { increment: 1 } },
    });
    return;
  }
  const secondary = [
    ...new Set(value.secondaryMuscles.filter((muscle) => muscle !== value.primaryMuscle)),
  ];
  if (!existing) {
    await tx.exercise.create({
      data: {
        id: value.id,
        origin: 'user',
        ownerUserId: userId,
        namePt: value.namePt,
        alternativeName: value.alternativeName ?? null,
        activityType: value.activityType,
        description: value.description ?? null,
        instructions: value.instructions ?? null,
        status: value.status,
        muscles: {
          create: [
            { muscleGroup: value.primaryMuscle, role: 'primary' },
            ...secondary.map((muscleGroup) => ({ muscleGroup, role: 'secondary' as const })),
          ],
        },
        equipmentRequirements: {
          create: [...new Set(value.equipmentTypes)].map((equipmentType) => ({ equipmentType })),
        },
      },
    });
    return;
  }
  await tx.exerciseMuscle.deleteMany({ where: { exerciseId: value.id } });
  await tx.exerciseEquipmentRequirement.deleteMany({ where: { exerciseId: value.id } });
  await tx.exercise.update({
    where: { id: value.id },
    data: {
      namePt: value.namePt,
      alternativeName: value.alternativeName ?? null,
      activityType: value.activityType,
      description: value.description ?? null,
      instructions: value.instructions ?? null,
      status: value.status,
      version: { increment: 1 },
      muscles: {
        create: [
          { muscleGroup: value.primaryMuscle, role: 'primary' },
          ...secondary.map((muscleGroup) => ({ muscleGroup, role: 'secondary' as const })),
        ],
      },
      equipmentRequirements: {
        create: [...new Set(value.equipmentTypes)].map((equipmentType) => ({ equipmentType })),
      },
    },
  });
}
