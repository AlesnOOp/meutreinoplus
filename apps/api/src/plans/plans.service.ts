import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  loadExceedsLimit,
  planSyncMutationSchema,
  canonicalPlanContent,
  canonicalJsonString,
  planReconcileResultSchema,
  type PlanReconcileRequest,
  type PlanReconcileResult,
  planSyncPayloadSchema,
  toCanonicalKilograms,
  type PlanExerciseInput,
  type PlanSetInput,
  type PlanSyncPayload,
  type PlanView,
} from '@meutreino/shared';
import { Prisma } from '../generated/prisma/client';
import { SecurityAuditService } from '../identity/audit.service';
import { sha256 } from '../identity/crypto';
import { fail } from '../identity/http';
import { PrismaService } from '../prisma/prisma.service';

const planInclude = {
  exercises: {
    where: { active: true },
    orderBy: { orderIndex: 'asc' as const },
    include: {
      exercise: { select: { namePt: true } },
      sets: { orderBy: { setIndex: 'asc' as const } },
      equipmentPrefs: {
        include: {
          gym: { select: { name: true } },
          equipment: { select: { name: true, machineNumber: true, status: true } },
        },
      },
    },
  },
} satisfies Prisma.WorkoutPlanInclude;

type PlanRecord = Prisma.WorkoutPlanGetPayload<{ include: typeof planInclude }>;
type Tx = Prisma.TransactionClient;
type Choice = 'keep_server' | 'keep_local' | 'keep_both';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: SecurityAuditService,
  ) {}

  async list(
    userId: string,
    page: number,
    pageSize: number,
    includeArchived: boolean,
  ): Promise<{ page: number; pageSize: number; total: number; items: PlanView[] }> {
    const where = {
      ownerUserId: userId,
      ...(includeArchived ? {} : { status: 'active' as const }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.workoutPlan.count({ where }),
      this.prisma.workoutPlan.findMany({
        where,
        include: planInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { page, pageSize, total, items: rows.map(presentPlan) };
  }

  async read(userId: string, planId: string): Promise<PlanView> {
    return presentPlan(await this.owned(userId, planId));
  }

  async create(userId: string, input: PlanSyncPayload): Promise<PlanView> {
    const plan = await this.prisma.$transaction(async (tx) => {
      await this.insertPlan(tx, userId, input, 1);
      await this.persistTree(tx, userId, input.id, input.exercises);
      await this.revise(tx, input.id);
      return this.ownedTx(tx, userId, input.id);
    });
    await this.audit.record({ userId, eventType: 'plan_created', outcome: 'success' });
    return presentPlan(plan);
  }

  async updateMeta(
    userId: string,
    planId: string,
    baseVersion: number,
    input: { name: string; description: string | null; accent?: PlanSyncPayload['accent'] },
  ): Promise<PlanView> {
    const plan = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedTx(tx, userId, planId);
      this.ensureActive(current);
      await this.bump(tx, userId, planId, baseVersion, {
        name: input.name,
        description: input.description,
        accent: input.accent ?? null,
      });
      await this.revise(tx, planId);
      return this.ownedTx(tx, userId, planId);
    });
    await this.audit.record({ userId, eventType: 'plan_updated', outcome: 'success' });
    return presentPlan(plan);
  }

  async duplicate(userId: string, planId: string): Promise<PlanView> {
    const source = presentPlan(await this.owned(userId, planId));
    const copy = planSyncPayloadSchema.parse({
      id: randomUUID(),
      name: copyName(source.name),
      description: source.description,
      accent: source.accent,
      status: 'active',
      exercises: cloneExercises(source.exercises),
    });
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.workoutPlan.create({
        data: {
          id: copy.id,
          ownerUserId: userId,
          authoredByUserId: userId,
          name: copy.name,
          description: copy.description ?? null,
          accent: copy.accent ?? null,
          status: 'active',
          version: 1,
          duplicatedFromId: planId,
        },
      });
      await this.persistTree(tx, userId, copy.id, copy.exercises);
      await this.revise(tx, copy.id);
      return this.ownedTx(tx, userId, copy.id);
    });
    await this.audit.record({ userId, eventType: 'plan_duplicated', outcome: 'success' });
    return presentPlan(plan);
  }

  async archive(userId: string, planId: string, baseVersion: number): Promise<PlanView> {
    return this.setStatus(userId, planId, baseVersion, 'archived', 'plan_archived');
  }

  async restore(userId: string, planId: string, baseVersion: number): Promise<PlanView> {
    return this.setStatus(userId, planId, baseVersion, 'active', 'plan_restored');
  }

  async addExercise(
    userId: string,
    planId: string,
    baseVersion: number,
    exercise: PlanExerciseInput,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      const exercises = [...current.exercises, exercise];
      return exercises;
    });
  }

  async updateExercise(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
    exercise: PlanExerciseInput,
    options: { replaceSets: boolean; replaceEquipment: boolean },
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.map((item) =>
        item.id === planExerciseId
          ? {
              ...item,
              exerciseId: exercise.exerciseId,
              restSeconds: exercise.restSeconds,
              notes: exercise.notes ?? null,
              equipment: options.replaceEquipment ? exercise.equipment : item.equipment,
              sets: options.replaceSets ? exercise.sets : item.sets,
            }
          : item,
      );
    });
  }

  async replaceExercise(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
    exerciseId: string,
    preserveSets: boolean,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.map((item) => {
        if (item.id !== planExerciseId) {
          return item;
        }
        return {
          ...item,
          exerciseId,
          sets: preserveSets ? item.sets : [emptySet()],
        };
      });
    });
  }

  async removeExercise(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.filter((item) => item.id !== planExerciseId);
    });
  }

  async duplicateExercise(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      const source = current.exercises.find((item) => item.id === planExerciseId);
      if (!source) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
      }
      return [...current.exercises, ...cloneExercises([source])];
    });
  }

  async reorderExercises(
    userId: string,
    planId: string,
    baseVersion: number,
    orderedIds: string[],
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      const byId = new Map(current.exercises.map((item) => [item.id, item]));
      if (
        orderedIds.length !== current.exercises.length ||
        orderedIds.some((id) => !byId.has(id))
      ) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'validation_error',
          'A ordem precisa incluir os exercícios ativos.',
        );
      }
      return orderedIds.map((id) => byId.get(id)!);
    });
  }

  async addSet(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
    set: PlanSetInput,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.map((item) =>
        item.id === planExerciseId ? { ...item, sets: [...item.sets, set] } : item,
      );
    });
  }

  async updateSet(
    userId: string,
    planId: string,
    planExerciseId: string,
    setId: string,
    baseVersion: number,
    set: PlanSetInput,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      const exercise = requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      requireItem(exercise.sets, setId, 'Série não encontrada.');
      return current.exercises.map((item) =>
        item.id === planExerciseId
          ? {
              ...item,
              sets: item.sets.map((currentSet) => (currentSet.id === setId ? set : currentSet)),
            }
          : item,
      );
    });
  }

  async removeSet(
    userId: string,
    planId: string,
    planExerciseId: string,
    setId: string,
    baseVersion: number,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      const exercise = requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      requireItem(exercise.sets, setId, 'Série não encontrada.');
      return current.exercises.map((item) =>
        item.id === planExerciseId
          ? { ...item, sets: item.sets.filter((currentSet) => currentSet.id !== setId) }
          : item,
      );
    });
  }

  async duplicateSet(
    userId: string,
    planId: string,
    planExerciseId: string,
    setId: string,
    baseVersion: number,
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.map((item) => {
        if (item.id !== planExerciseId) {
          return item;
        }
        const source = requireItem(item.sets, setId, 'Série não encontrada.');
        return {
          ...item,
          sets: [...item.sets, { ...source, id: randomUUID() }],
        };
      });
    });
  }

  async reorderSets(
    userId: string,
    planId: string,
    planExerciseId: string,
    baseVersion: number,
    orderedIds: string[],
  ): Promise<PlanView> {
    return this.mutate(userId, planId, baseVersion, 'plan_updated', (current) => {
      requireItem(current.exercises, planExerciseId, 'Exercício não encontrado.');
      return current.exercises.map((item) => {
        if (item.id !== planExerciseId) {
          return item;
        }
        const byId = new Map(item.sets.map((set) => [set.id, set]));
        if (orderedIds.length !== item.sets.length || orderedIds.some((id) => !byId.has(id))) {
          throw fail(
            HttpStatus.BAD_REQUEST,
            'validation_error',
            'A ordem precisa incluir as séries.',
          );
        }
        return { ...item, sets: orderedIds.map((id) => byId.get(id)!) };
      });
    });
  }

  async revisions(userId: string, planId: string) {
    await this.owned(userId, planId);
    const rows = await this.prisma.workoutPlanRevision.findMany({
      where: { planId },
      orderBy: { version: 'asc' },
      select: { version: true, createdAt: true },
    });
    return {
      items: rows.map((row) => ({ version: row.version, createdAt: row.createdAt.toISOString() })),
    };
  }

  async revision(userId: string, planId: string, version: number) {
    await this.owned(userId, planId);
    const row = await this.prisma.workoutPlanRevision.findUnique({
      where: { planId_version: { planId, version } },
    });
    if (!row) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Revisão não encontrada.');
    }
    return { version: row.version, createdAt: row.createdAt.toISOString(), snapshot: row.snapshot };
  }

  async applySynced(
    tx: Tx,
    userId: string,
    operation: string,
    payload: PlanSyncPayload,
    expectedVersion: number | null,
  ): Promise<void> {
    const existing = await tx.workoutPlan.findUnique({ where: { id: payload.id } });
    if (existing && existing.ownerUserId !== userId) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Ficha não encontrada.');
    }
    if (operation === 'delete' || payload.status === 'archived') {
      if (!existing) {
        if (operation === 'delete') return;
        await this.insertPlan(tx, userId, payload, 1);
        await this.persistTree(tx, userId, payload.id, payload.exercises);
        await this.revise(tx, payload.id);
        return;
      }
      await this.bump(tx, userId, payload.id, expectedVersion ?? 0, {
        name: payload.name,
        description: payload.description ?? null,
        accent: payload.accent ?? null,
        status: 'archived',
        archivedAt: existing.archivedAt ?? new Date(),
      });
      await this.persistTree(tx, userId, payload.id, payload.exercises);
      await this.revise(tx, payload.id);
      return;
    }
    if (!existing) {
      await this.insertPlan(tx, userId, payload, 1);
      await this.persistTree(tx, userId, payload.id, payload.exercises);
      await this.revise(tx, payload.id);
      return;
    }
    await this.bump(tx, userId, payload.id, expectedVersion ?? 0, {
      name: payload.name,
      description: payload.description ?? null,
      accent: payload.accent ?? null,
      status: 'active',
      archivedAt: null,
    });
    await this.persistTree(tx, userId, payload.id, payload.exercises);
    await this.revise(tx, payload.id);
  }

  async preserveConflict(
    userId: string,
    operationId: string,
    planId: string,
    baseVersion: number | null,
    payload: PlanSyncPayload,
  ): Promise<void> {
    const plan = await this.prisma.workoutPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.ownerUserId !== userId) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Ficha não encontrada.');
    }
    await this.prisma.workoutPlanConflict.upsert({
      where: { id: operationId },
      update: {},
      create: {
        id: operationId,
        userId,
        planId,
        baseVersion,
        payload: jsonValue(payload),
        status: 'open',
      },
    });
  }

  async listConflicts(userId: string) {
    const rows = await this.prisma.workoutPlanConflict.findMany({
      where: { userId, status: 'open' },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        planId: row.planId,
        baseVersion: row.baseVersion,
        status: row.status,
        preservedPlanId: row.preservedPlanId,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
      })),
    };
  }

  async resolveConflict(
    userId: string,
    conflictId: string,
    choice: Choice,
    payload: PlanSyncPayload | undefined,
  ) {
    const existing = await this.prisma.workoutPlanConflict.findFirst({
      where: { id: conflictId, userId },
    });
    if (!existing) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Conflito não encontrado.');
    }
    const sourceRequest = planSyncMutationSchema.safeParse(existing.payload);
    if (
      choice === 'keep_local' &&
      payload &&
      sourceRequest.success &&
      sourceRequest.data.revisionOrigin &&
      canonicalPlanContent(payload) !== canonicalPlanContent(sourceRequest.data)
    )
      throw fail(
        HttpStatus.CONFLICT,
        'revision_source_mismatch',
        'Resolva a revisão original antes das edições posteriores.',
      );
    if (existing.status !== 'open') {
      if (existing.status !== choice) {
        throw fail(HttpStatus.CONFLICT, 'conflict_resolved', 'Este conflito já foi resolvido.');
      }
      const plan = presentPlan(await this.owned(userId, existing.planId));
      const preserved = existing.preservedPlanId
        ? presentPlan(await this.owned(userId, existing.preservedPlanId))
        : null;
      const origin = await this.prisma.planRevisionOrigin.findUnique({
        where: { operationId: existing.id },
      });
      return {
        choice,
        plan,
        preservedPlan: preserved,
        ...(origin
          ? {
              revision: { originId: origin.id, version: origin.version, snapshot: origin.snapshot },
            }
          : {}),
      };
    }
    const stored = planSyncPayloadSchema.safeParse(existing.payload);
    const incoming = payload ?? (stored.success ? stored.data : undefined);
    if ((choice === 'keep_local' || choice === 'keep_both') && !incoming) {
      throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'A versão local não pôde ser lida.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM meutreino.workout_plans WHERE id=${existing.planId}::uuid AND owner_user_id=${userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM meutreino.workout_plan_conflicts WHERE id=${conflictId}::uuid AND user_id=${userId}::uuid FOR UPDATE`;
      const claimed = await tx.workoutPlanConflict.findUniqueOrThrow({
        where: { id: existing.id },
      });
      if (claimed.status !== 'open')
        throw fail(HttpStatus.CONFLICT, 'conflict_resolved', 'Este conflito já foi resolvido.');
      const current = await this.ownedTx(tx, userId, existing.planId);
      let preserved: PlanRecord | null = null;
      if (choice === 'keep_local' && incoming) {
        await this.bump(tx, userId, current.id, current.version, {
          name: incoming.name,
          description: incoming.description ?? null,
          accent: incoming.accent ?? null,
          status: incoming.status,
          archivedAt: incoming.status === 'archived' ? new Date() : null,
        });
        await this.persistTree(tx, userId, current.id, incoming.exercises);
        await this.revise(tx, current.id);
        const source = planSyncMutationSchema.safeParse(existing.payload);
        if (
          source.success &&
          source.data.revisionOrigin &&
          canonicalPlanContent(source.data) === canonicalPlanContent(incoming)
        ) {
          const official = await tx.workoutPlanRevision.findUniqueOrThrow({
            where: { planId_version: { planId: current.id, version: current.version + 1 } },
          });
          const receipt = await tx.syncOperation.findUniqueOrThrow({ where: { id: existing.id } });
          await tx.planRevisionOrigin.create({
            data: {
              id: source.data.revisionOrigin.id,
              planId: current.id,
              userId,
              version: official.version,
              parentId: source.data.revisionOrigin.parentId,
              requestHash: receipt.payloadHash,
              operationId: receipt.id,
              snapshot: official.snapshot as Prisma.InputJsonValue,
            },
          });
        }
      }
      if (choice === 'keep_both' && incoming) {
        const copy = planSyncPayloadSchema.parse({
          ...incoming,
          id: randomUUID(),
          name: copyName(incoming.name),
          status: 'active',
          exercises: cloneExercises(incoming.exercises),
        });
        await tx.workoutPlan.create({
          data: {
            id: copy.id,
            ownerUserId: userId,
            authoredByUserId: userId,
            name: copy.name,
            description: copy.description ?? null,
            accent: copy.accent ?? null,
            status: 'active',
            version: 1,
            duplicatedFromId: current.id,
          },
        });
        await this.persistTree(tx, userId, copy.id, copy.exercises);
        await this.revise(tx, copy.id);
        preserved = await this.ownedTx(tx, userId, copy.id);
      }
      const updated = await tx.workoutPlanConflict.updateMany({
        where: { id: conflictId, userId, status: 'open' },
        data: {
          status: choice,
          preservedPlanId: preserved?.id ?? null,
          resolvedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw fail(HttpStatus.CONFLICT, 'conflict_resolved', 'Este conflito já foi resolvido.');
      }
      return {
        plan: await this.ownedTx(tx, userId, current.id),
        preserved,
      };
    });
    await this.audit.record({ userId, eventType: 'plan_conflict_resolved', outcome: 'success' });
    return {
      choice,
      plan: presentPlan(result.plan),
      preservedPlan: result.preserved ? presentPlan(result.preserved) : null,
      ...(await this.originResult(existing.id)),
    };
  }

  async reconcileConflict(
    userId: string,
    conflictId: string,
    input: PlanReconcileRequest,
    authSessionId: string,
  ) {
    const auth = await this.prisma.authSession.findFirst({
      where: { id: authSessionId, userId, revokedAt: null },
    });
    if (!auth?.deviceId) throw fail(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Entre novamente.');
    const requestHash = sha256(canonicalJsonString(input));
    const conflict = await this.prisma.workoutPlanConflict.findFirst({
      where: { id: conflictId, userId },
    });
    if (!conflict) throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Conflito não encontrado.');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plan:${conflict.planId}`},0))`;
        await tx.$queryRaw`SELECT id FROM meutreino.workout_plans WHERE id=${conflict.planId}::uuid AND owner_user_id=${userId}::uuid FOR UPDATE`;
        const previous = await tx.planReconciliation.findUnique({ where: { id: input.id } });
        if (previous) {
          if (
            previous.userId !== userId ||
            previous.conflictId !== conflictId ||
            previous.requestHash !== requestHash
          )
            throw fail(
              HttpStatus.CONFLICT,
              'decision_reused',
              'A decisão já possui outro conteúdo.',
            );
          return planReconcileResultSchema.parse(previous.result);
        }
        await tx.$queryRaw`SELECT id FROM meutreino.workout_plan_conflicts WHERE id=${conflictId}::uuid FOR UPDATE`;
        const claimed = await tx.workoutPlanConflict.findUniqueOrThrow({
          where: { id: conflictId },
        });
        if (claimed.status !== 'open')
          throw fail(
            HttpStatus.CONFLICT,
            'conflict_resolved',
            'Outro aparelho já resolveu este conflito. Atualize a ficha; o conteúdo local continua preservado.',
          );
        const current = await this.ownedTx(tx, userId, conflict.planId);
        if (current.version !== input.expectedVersion)
          throw fail(
            HttpStatus.CONFLICT,
            'reconciliation_stale',
            'A ficha mudou novamente. Atualize a prévia antes de decidir.',
          );
        const root = planSyncMutationSchema.parse(claimed.payload);
        if (!root.revisionOrigin)
          throw fail(
            HttpStatus.CONFLICT,
            'unsupported_legacy',
            'A origem legada exige recuperação assistida.',
          );
        const rootOp = input.operations.find((op) => op.id === conflictId);
        if (!rootOp || canonicalJsonString(rootOp.payload) !== canonicalJsonString(root))
          throw fail(
            HttpStatus.BAD_REQUEST,
            'invalid_reconciliation',
            'A operação original não confere.',
          );
        const ids = new Set<string>(),
          keys = new Set<string>(),
          origins = new Set<string>();
        const pending = [...input.operations];
        while (pending.length) {
          const index = pending.findIndex(
            (op) =>
              op.id === conflictId ||
              (op.payload.revisionOrigin?.parentId &&
                origins.has(op.payload.revisionOrigin.parentId)),
          );
          if (index < 0)
            throw fail(
              HttpStatus.BAD_REQUEST,
              'invalid_reconciliation',
              'A cadeia de dependências não confere.',
            );
          const op = pending.splice(index, 1)[0]!;
          const origin = op.payload.revisionOrigin;
          if (
            !origin ||
            op.entityId !== current.id ||
            op.payload.id !== current.id ||
            ids.has(op.id) ||
            keys.has(op.idempotencyKey) ||
            origins.has(origin.id) ||
            sha256(canonicalJsonString(op.payload)) !== op.payloadHash
          )
            throw fail(
              HttpStatus.BAD_REQUEST,
              'invalid_reconciliation',
              'Identidade ou conteúdo da operação inválido.',
            );
          ids.add(op.id);
          keys.add(op.idempotencyKey);
          origins.add(origin.id);
          const receipt = await tx.syncOperation.findFirst({
            where: { OR: [{ id: op.id }, { idempotencyKey: op.idempotencyKey }] },
          });
          if (
            receipt &&
            (receipt.id !== op.id ||
              receipt.userId !== userId ||
              receipt.entityId !== current.id ||
              receipt.entityType !== 'workout_plan' ||
              receipt.operation !== op.operation ||
              receipt.idempotencyKey !== op.idempotencyKey ||
              receipt.payloadHash !== op.payloadHash ||
              receipt.baseVersion !== op.baseVersion)
          )
            throw fail(
              HttpStatus.CONFLICT,
              'operation_reused',
              'A identidade da operação já possui outro conteúdo.',
            );
          const closure = await tx.planOperationClosure.findFirst({
            where: { OR: [{ operationId: op.id }, { idempotencyKey: op.idempotencyKey }] },
          });
          if (closure)
            throw fail(
              HttpStatus.CONFLICT,
              'operation_closed',
              'Uma operação já pertence a outra decisão.',
            );
        }
        const source = input.sourceOriginId
          ? input.operations.find((op) => op.payload.revisionOrigin!.id === input.sourceOriginId)
          : null;
        if (input.descendants === 'reapply' && (!source || source.id === conflictId))
          throw fail(
            HttpStatus.BAD_REQUEST,
            'invalid_reconciliation',
            'Selecione explicitamente uma edição posterior para reaplicar.',
          );
        if (input.descendants === 'archive' && input.sourceOriginId !== null)
          throw fail(
            HttpStatus.BAD_REQUEST,
            'invalid_reconciliation',
            'Arquivar não reaplica uma edição.',
          );
        let preservedPlan: PlanView | null = null;
        if (input.choice === 'keep_both') {
          const copy = planSyncPayloadSchema.parse({
            ...root,
            id: randomUUID(),
            name: copyName(root.name),
            status: 'active',
            exercises: cloneExercises(root.exercises),
          });
          await this.insertPlan(tx, userId, copy, 1);
          await tx.workoutPlan.update({
            where: { id: copy.id },
            data: { duplicatedFromId: current.id },
          });
          await this.persistTree(tx, userId, copy.id, copy.exercises);
          await this.revise(tx, copy.id);
          preservedPlan = presentPlan(await this.ownedTx(tx, userId, copy.id));
        }
        let derived: PlanReconcileResult['derived'] = null;
        if (input.descendants === 'reapply' && source) {
          const target = preservedPlan ?? presentPlan(current);
          const originId = randomUUID();
          const payload = planSyncMutationSchema.parse({
            ...source.payload,
            id: target.id,
            exercises: preservedPlan
              ? cloneExercises(source.payload.exercises)
              : source.payload.exercises,
            revisionOrigin: { id: originId, parentId: null },
          });
          const operation = {
            id: randomUUID(),
            entityType: 'workout_plan' as const,
            entityId: target.id,
            operation: 'upsert' as const,
            idempotencyKey: `reconciliation:${input.id}:derived`,
            payloadHash: sha256(canonicalJsonString(payload)),
            baseVersion: target.version,
            createdAt: new Date().toISOString(),
            payload,
          };
          await this.applySynced(tx, userId, 'upsert', payload, target.version);
          const snapshot = presentPlan(await this.ownedTx(tx, userId, target.id));
          await tx.syncOperation.create({
            data: {
              id: operation.id,
              userId,
              deviceId: auth.deviceId!,
              entityType: 'workout_plan',
              entityId: target.id,
              operation: 'upsert',
              idempotencyKey: operation.idempotencyKey,
              payloadHash: operation.payloadHash,
              baseVersion: operation.baseVersion,
              status: 'applied',
              appliedAt: new Date(),
            },
          });
          await tx.planRevisionOrigin.create({
            data: {
              id: originId,
              planId: target.id,
              userId,
              version: snapshot.version,
              operationId: operation.id,
              requestHash: operation.payloadHash,
              snapshot: jsonValue(snapshot),
            },
          });
          derived = {
            sourceOriginId: input.sourceOriginId!,
            operation,
            revision: { originId, version: snapshot.version, snapshot },
          };
          if (preservedPlan) preservedPlan = snapshot;
        }
        const closed: PlanReconcileResult['closed'] = [];
        for (const op of input.operations) {
          const receipt = await tx.syncOperation.findUnique({
            where: { idempotencyKey: op.idempotencyKey },
          });
          closed.push({
            id: op.id,
            status: receipt?.status === 'applied' ? 'applied' : 'closed',
            originId: op.payload.revisionOrigin!.id,
          });
        }
        const result = planReconcileResultSchema.parse({
          id: input.id,
          choice: input.choice,
          plan: presentPlan(await this.ownedTx(tx, userId, current.id)),
          preservedPlan,
          closed,
          derived,
        });
        await tx.planReconciliation.create({
          data: {
            id: input.id,
            userId,
            planId: current.id,
            conflictId,
            requestHash,
            request: jsonValue(input),
            result: jsonValue(result),
          },
        });
        for (const op of input.operations)
          await tx.planOperationClosure.create({
            data: {
              idempotencyKey: op.idempotencyKey,
              operationId: op.id,
              userId,
              planId: current.id,
              decisionId: input.id,
              payloadHash: op.payloadHash,
              baseVersion: op.baseVersion,
            },
          });
        await tx.workoutPlanConflict.update({
          where: { id: conflictId },
          data: {
            status: input.choice,
            preservedPlanId: preservedPlan?.id ?? null,
            resolvedAt: new Date(),
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 },
    );
  }

  private async originResult(operationId: string) {
    const origin = await this.prisma.planRevisionOrigin.findUnique({ where: { operationId } });
    return origin
      ? { revision: { originId: origin.id, version: origin.version, snapshot: origin.snapshot } }
      : {};
  }

  private async setStatus(
    userId: string,
    planId: string,
    baseVersion: number,
    status: 'active' | 'archived',
    eventType: string,
  ): Promise<PlanView> {
    const plan = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedTx(tx, userId, planId);
      if (status === 'archived') {
        this.ensureActive(current);
      }
      await this.bump(tx, userId, planId, baseVersion, {
        status,
        archivedAt: status === 'archived' ? new Date() : null,
      });
      await this.revise(tx, planId);
      return this.ownedTx(tx, userId, planId);
    });
    await this.audit.record({ userId, eventType, outcome: 'success' });
    return presentPlan(plan);
  }

  private async mutate(
    userId: string,
    planId: string,
    baseVersion: number,
    eventType: string,
    change: (current: PlanView) => PlanExerciseInput[],
  ): Promise<PlanView> {
    const plan = await this.prisma.$transaction(async (tx) => {
      const current = await this.ownedTx(tx, userId, planId);
      this.ensureActive(current);
      const exercises = change(presentPlan(current));
      await this.bump(tx, userId, planId, baseVersion, {});
      await this.persistTree(tx, userId, planId, exercises);
      await this.revise(tx, planId);
      return this.ownedTx(tx, userId, planId);
    });
    await this.audit.record({ userId, eventType, outcome: 'success' });
    return presentPlan(plan);
  }

  private async insertPlan(tx: Tx, userId: string, payload: PlanSyncPayload, version: number) {
    await tx.workoutPlan.create({
      data: {
        id: payload.id,
        ownerUserId: userId,
        authoredByUserId: userId,
        name: payload.name,
        description: payload.description ?? null,
        accent: payload.accent ?? null,
        status: payload.status,
        version,
        archivedAt: payload.status === 'archived' ? new Date() : null,
      },
    });
  }

  private async bump(
    tx: Tx,
    userId: string,
    planId: string,
    baseVersion: number,
    data: Prisma.WorkoutPlanUpdateManyMutationInput,
  ) {
    const updated = await tx.workoutPlan.updateMany({
      where: { id: planId, ownerUserId: userId, version: baseVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw fail(
        HttpStatus.CONFLICT,
        'version_mismatch',
        'A ficha mudou. As duas versões foram preservadas para revisão.',
      );
    }
  }

  private async persistTree(
    tx: Tx,
    userId: string,
    planId: string,
    exercises: PlanExerciseInput[],
  ) {
    assertDistinct(
      exercises.map((item) => item.id),
      'O mesmo exercício da ficha foi enviado duas vezes.',
    );
    if (exercises.length > 40) {
      throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'A ficha aceita até 40 exercícios.');
    }
    await tx.workoutPlanExercise.updateMany({
      where: { planId, active: true },
      data: { orderIndex: { increment: 1000 } },
    });
    const incomingIds = new Set(exercises.map((item) => item.id));
    const foreign =
      incomingIds.size === 0
        ? []
        : await tx.workoutPlanExercise.findMany({
            where: { id: { in: [...incomingIds] }, planId: { not: planId } },
            select: { id: true },
          });
    if (foreign.length > 0) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
    }
    const current = await tx.workoutPlanExercise.findMany({
      where: { planId },
      select: { id: true, exerciseId: true },
    });
    const known = new Map(current.map((item) => [item.id, item.exerciseId]));
    for (const [index, exercise] of exercises.entries()) {
      await this.assertExerciseVisible(tx, userId, exercise.exerciseId, known.get(exercise.id));
      await this.assertEquipment(tx, userId, exercise.equipment);
      const data = {
        exerciseId: exercise.exerciseId,
        orderIndex: index + 1,
        restSeconds: exercise.restSeconds,
        notes: exercise.notes ?? null,
        active: true,
      };
      if (known.has(exercise.id)) {
        await tx.workoutPlanExercise.update({ where: { id: exercise.id }, data });
      } else {
        await tx.workoutPlanExercise.create({ data: { id: exercise.id, planId, ...data } });
      }
      await this.persistSets(tx, exercise.id, exercise.sets);
      await tx.workoutPlanExerciseEquipment.deleteMany({ where: { planExerciseId: exercise.id } });
      if (exercise.equipment.length > 0) {
        await tx.workoutPlanExerciseEquipment.createMany({
          data: exercise.equipment.map((item) => ({
            planExerciseId: exercise.id,
            gymId: item.gymId,
            equipmentId: item.equipmentId,
          })),
        });
      }
    }
    await tx.workoutPlanExercise.updateMany({
      where: { planId, active: true, id: { notIn: [...incomingIds] } },
      data: { active: false },
    });
  }

  private async persistSets(tx: Tx, planExerciseId: string, sets: PlanSetInput[]) {
    assertDistinct(
      sets.map((set) => set.id),
      'A mesma série foi enviada duas vezes.',
    );
    if (sets.length > 20) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'validation_error',
        'Cada exercício aceita até 20 séries.',
      );
    }
    await tx.workoutPlanSet.updateMany({
      where: { planExerciseId },
      data: { setIndex: { increment: 1000 } },
    });
    const setIds = sets.map((set) => set.id);
    const foreign =
      setIds.length === 0
        ? []
        : await tx.workoutPlanSet.findMany({
            where: { id: { in: setIds }, planExerciseId: { not: planExerciseId } },
            select: { id: true },
          });
    if (foreign.length > 0) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Série não encontrada.');
    }
    const existing = new Set(
      (
        await tx.workoutPlanSet.findMany({
          where: { planExerciseId },
          select: { id: true },
        })
      ).map((set) => set.id),
    );
    for (const [index, set] of sets.entries()) {
      const stored = storedLoad(set);
      const data = {
        setIndex: index + 1,
        setKind: set.kind,
        targetRepetitions: set.repetitions,
        loadType: stored.loadType,
        loadUnit: stored.loadUnit,
        targetLoad: stored.targetLoad,
        targetLoadKg: stored.targetLoadKg,
        targetDurationSeconds: stored.duration,
        restSeconds: set.restSeconds,
        notes: set.notes ?? null,
      };
      if (existing.has(set.id)) {
        await tx.workoutPlanSet.update({ where: { id: set.id }, data });
      } else {
        await tx.workoutPlanSet.create({ data: { id: set.id, planExerciseId, ...data } });
      }
    }
    await tx.workoutPlanSet.deleteMany({
      where: { planExerciseId, id: { notIn: sets.map((set) => set.id) } },
    });
  }

  private async revise(tx: Tx, planId: string) {
    const plan = await tx.workoutPlan.findUniqueOrThrow({
      where: { id: planId },
      include: planInclude,
    });
    await tx.workoutPlanRevision.create({
      data: {
        planId,
        version: plan.version,
        snapshot: jsonValue(presentPlan(plan)),
      },
    });
  }

  private async assertExerciseVisible(
    tx: Tx,
    userId: string,
    exerciseId: string,
    previousExerciseId: string | undefined,
  ) {
    const exercise = await tx.exercise.findUnique({ where: { id: exerciseId } });
    const visible =
      exercise &&
      (exercise.origin === 'system' || exercise.ownerUserId === userId) &&
      (exercise.status === 'active' || exerciseId === previousExerciseId);
    if (!visible) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
    }
  }

  private async assertEquipment(tx: Tx, userId: string, equipment: PlanExerciseInput['equipment']) {
    const gymIds = equipment.map((item) => item.gymId);
    assertDistinct(gymIds, 'Escolha um equipamento por academia.');
    for (const preference of equipment) {
      const row = await tx.equipment.findUnique({ where: { id: preference.equipmentId } });
      if (!row || row.userId !== userId || row.gymId !== preference.gymId) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Equipamento não encontrado.');
      }
      const gym = await tx.gym.findFirst({
        where: { id: preference.gymId, ownerUserId: userId },
        select: { id: true },
      });
      if (!gym) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
      }
    }
  }

  private ensureActive(plan: { status: string }) {
    if (plan.status !== 'active') {
      throw fail(HttpStatus.CONFLICT, 'plan_archived', 'Restaure a ficha antes de alterá-la.');
    }
  }

  private async owned(userId: string, planId: string): Promise<PlanRecord> {
    return this.ownedTx(this.prisma, userId, planId);
  }

  private async ownedTx(
    tx: Tx | PrismaService,
    userId: string,
    planId: string,
  ): Promise<PlanRecord> {
    const plan = await tx.workoutPlan.findFirst({
      where: { id: planId, ownerUserId: userId },
      include: planInclude,
    });
    if (!plan) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Ficha não encontrada.');
    }
    return plan;
  }
}

function presentPlan(plan: PlanRecord): PlanView {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    accent: plan.accent,
    status: plan.status,
    version: plan.version,
    duplicatedFromId: plan.duplicatedFromId,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    archivedAt: plan.archivedAt?.toISOString() ?? null,
    exercises: plan.exercises.map((exercise) => ({
      id: exercise.id,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exercise.namePt,
      orderIndex: exercise.orderIndex,
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
      equipment: exercise.equipmentPrefs.map((preference) => ({
        gymId: preference.gymId,
        gymName: preference.gym.name,
        equipmentId: preference.equipmentId,
        equipmentName: preference.equipment.name,
        machineNumber: preference.equipment.machineNumber,
        equipmentStatus: preference.equipment.status,
      })),
      sets: exercise.sets.map((set) => ({
        id: set.id,
        setIndex: set.setIndex,
        kind: set.setKind,
        repetitions: set.targetRepetitions,
        load: decimalToString(set.targetLoad),
        loadUnit: set.loadUnit,
        loadType: set.loadType,
        durationSeconds: set.targetDurationSeconds,
        restSeconds: set.restSeconds,
        notes: set.notes,
      })),
    })),
  };
}

function storedLoad(set: PlanSetInput): {
  loadType: PlanSetInput['loadType'];
  loadUnit: PlanSetInput['loadUnit'];
  targetLoad: string | null;
  targetLoadKg: string | null;
  duration: number | null;
} {
  const duration = set.durationSeconds ?? null;
  if (set.loadType === 'bodyweight') {
    if (set.load !== null) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'validation_error',
        'Exercício sem carga externa não recebe peso.',
      );
    }
    return {
      loadType: 'bodyweight',
      loadUnit: set.loadUnit,
      targetLoad: null,
      targetLoadKg: null,
      duration,
    };
  }
  if (set.loadType === 'time') {
    if (set.load !== null || duration === null) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'validation_error',
        'Uma série por tempo precisa da duração e não usa carga.',
      );
    }
    return {
      loadType: 'time',
      loadUnit: set.loadUnit,
      targetLoad: null,
      targetLoadKg: null,
      duration,
    };
  }
  if (set.load === null) {
    return {
      loadType: set.loadType,
      loadUnit: set.loadUnit,
      targetLoad: null,
      targetLoadKg: null,
      duration: null,
    };
  }
  if (loadExceedsLimit(set.load, set.loadUnit)) {
    throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'A carga ultrapassa 2000 kg.');
  }
  return {
    loadType: set.loadType,
    loadUnit: set.loadUnit,
    targetLoad: set.load,
    targetLoadKg: toCanonicalKilograms(set.load, set.loadUnit),
    duration: null,
  };
}

function emptySet(): PlanSetInput {
  return {
    id: randomUUID(),
    setIndex: 1,
    kind: 'normal',
    repetitions: null,
    load: null,
    loadUnit: 'kg',
    loadType: 'fixed',
    durationSeconds: null,
    restSeconds: null,
    notes: null,
  };
}

function cloneExercises(exercises: PlanExerciseInput[]): PlanExerciseInput[] {
  return exercises.map((exercise, index) => ({
    ...exercise,
    id: randomUUID(),
    orderIndex: index + 1,
    sets: exercise.sets.map((set, setIndex) => ({
      ...set,
      id: randomUUID(),
      setIndex: setIndex + 1,
    })),
  }));
}

function copyName(name: string): string {
  const suffix = ' (cópia)';
  return `${name.slice(0, 120 - suffix.length)}${suffix}`;
}

function requireItem<T extends { id: string }>(items: T[], id: string, message: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) {
    throw fail(HttpStatus.NOT_FOUND, 'not_found', message);
  }
  return found;
}

function assertDistinct(ids: string[], message: string) {
  if (new Set(ids).size !== ids.length) {
    throw fail(HttpStatus.BAD_REQUEST, 'validation_error', message);
  }
}

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
