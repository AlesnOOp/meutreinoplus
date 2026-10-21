import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import {
  LoadValueError,
  hasUnfinishedPlannedSets,
  mergePerformedSets,
  performedSetFingerprint,
  projectClock,
  projectRest,
  sessionPlanSnapshotSchema,
  sessionSummary,
  sessionSyncPayloadSchema,
  toCanonicalKilograms,
  canonicalJsonString,
  type PerformedCorrectionSync,
  type PerformedSetSync,
  type SessionSyncPayload,
  type SyncOperationEnvelope,
} from '@meutreino/shared';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { sha256 } from '../identity/crypto';
import { fail } from '../identity/http';
import { PrismaService } from '../prisma/prisma.service';
import { invalidSessionReferences, validateSessionReferences } from './session-reference-guard';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

const sessionInclude = {
  exercises: {
    orderBy: { orderIndex: 'asc' as const },
    include: {
      sets: {
        orderBy: { setIndex: 'asc' as const },
        include: { corrections: { orderBy: { createdAt: 'asc' as const } } },
      },
      feedback: true,
    },
  },
  timeEvents: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.WorkoutSessionInclude;

type LoadedSession = Prisma.WorkoutSessionGetPayload<{ include: typeof sessionInclude }>;
type Tx = Prisma.TransactionClient;
type PushOperation = SyncOperationEnvelope & { payload: unknown };

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    userId: string,
    input: {
      id?: string;
      planId: string;
      gymId?: string | null;
      startedAt?: string;
      exerciseSessions?: Array<{ id: string; planExerciseId: string }>;
    },
  ) {
    const sessionId = input.id ?? randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.workoutSession.findUnique({ where: { id: sessionId } });
        if (existing) {
          if (existing.userId !== userId) {
            throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Treino não encontrado.');
          }
          if (
            existing.workoutPlanId !== input.planId ||
            (input.gymId !== undefined && existing.gymId !== input.gymId)
          )
            invalidSessionReferences();
          const children = await tx.exerciseSession.findMany({
            where: { workoutSessionId: sessionId },
          });
          if (
            input.exerciseSessions?.some(
              (item) =>
                !children.some(
                  (child) => child.id === item.id && child.planExerciseId === item.planExerciseId,
                ),
            )
          )
            invalidSessionReferences();
          return this.present(tx, sessionId, userId, false);
        }
        const open = await tx.workoutSession.findFirst({
          where: { userId, status: { in: ['in_progress', 'paused'] } },
        });
        if (open) {
          throw fail(
            HttpStatus.CONFLICT,
            'session_open',
            'Já existe um treino em andamento. Continue ou cancele esse treino antes de iniciar outro.',
          );
        }
        const plan = await tx.workoutPlan.findFirst({
          where: { id: input.planId, ownerUserId: userId },
        });
        if (!plan || plan.status !== 'active') {
          throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Ficha não encontrada.');
        }
        const revision = await tx.workoutPlanRevision.findUnique({
          where: { planId_version: { planId: plan.id, version: plan.version } },
        });
        if (!revision) {
          throw fail(
            HttpStatus.CONFLICT,
            'plan_revision_missing',
            'A ficha ainda não tem uma revisão imutável para iniciar o treino.',
          );
        }
        const parsed = sessionPlanSnapshotSchema.safeParse(revision.snapshot);
        if (!parsed.success) {
          throw fail(
            HttpStatus.CONFLICT,
            'plan_revision_invalid',
            'A revisão da ficha não pode ser usada para iniciar o treino.',
          );
        }
        const snapshot = parsed.data;
        const supplied = input.exerciseSessions ?? [];
        if (
          new Set(supplied.map((item) => item.id)).size !== supplied.length ||
          new Set(supplied.map((item) => item.planExerciseId)).size !== supplied.length ||
          supplied.some(
            (item) => !snapshot.exercises.some((exercise) => exercise.id === item.planExerciseId),
          )
        ) {
          invalidSessionReferences();
        }
        const collisions = await tx.exerciseSession.count({
          where: { id: { in: supplied.map((item) => item.id) } },
        });
        if (collisions) invalidSessionReferences();
        let gymName: string | null = null;
        if (input.gymId) {
          const gym = await tx.gym.findFirst({ where: { id: input.gymId, ownerUserId: userId } });
          if (!gym) {
            throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
          }
          gymName = gym.name;
        }
        const started = resolveInstant(input.startedAt, new Date(0)).at;
        await tx.workoutSession.create({
          data: {
            id: sessionId,
            userId,
            workoutPlanId: plan.id,
            planVersion: revision.version,
            planNameSnapshot: snapshot.name,
            planSnapshot: jsonValue(snapshot),
            gymId: input.gymId ?? null,
            gymName,
            status: 'in_progress',
            startedAt: started,
            version: 1,
          },
        });
        const ids = new Map(
          (input.exerciseSessions ?? []).map((item) => [item.planExerciseId, item.id]),
        );
        for (const exercise of snapshot.exercises) {
          const equipment = input.gymId
            ? exercise.equipment.find((item) => item.gymId === input.gymId)
            : undefined;
          await tx.exerciseSession.create({
            data: {
              id: ids.get(exercise.id) ?? randomUUID(),
              workoutSessionId: sessionId,
              planExerciseId: exercise.id,
              exerciseId: exercise.exerciseId,
              exerciseNameSnapshot: (exercise.exerciseName ?? 'Exercício').slice(0, 160),
              orderIndex: exercise.orderIndex,
              status: 'pending',
              plannedRestSeconds: exercise.restSeconds,
              gymName,
              equipmentName: equipment?.equipmentName?.slice(0, 160) ?? null,
              machineNumber: equipment?.machineNumber?.slice(0, 40) ?? null,
            },
          });
        }
        return this.present(tx, sessionId, userId, false);
      });
    } catch (error) {
      if (isOpenSessionConstraint(error)) {
        throw fail(
          HttpStatus.CONFLICT,
          'session_open',
          'Já existe um treino em andamento. Continue ou cancele esse treino antes de iniciar outro.',
        );
      }
      throw error;
    }
  }

  async get(userId: string, sessionId: string) {
    return this.present(this.prisma, sessionId, userId, false);
  }

  async open(userId: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { userId, status: { in: ['in_progress', 'paused'] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!session) {
      return { session: null };
    }
    return { session: await this.present(this.prisma, session.id, userId, false) };
  }

  async list(
    userId: string,
    page: number,
    pageSize: number,
    status?: SessionSyncPayload['status'],
  ) {
    const where = { userId, ...(status ? { status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.workoutSession.count({ where }),
      this.prisma.workoutSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        planId: row.workoutPlanId,
        planName: row.planNameSnapshot,
        gymName: row.gymName,
        status: row.status,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
        version: row.version,
      })),
    };
  }

  async pause(userId: string, sessionId: string, occurredAt?: string) {
    return this.transition(userId, sessionId, 'paused', occurredAt);
  }

  async resume(userId: string, sessionId: string, occurredAt?: string) {
    return this.transition(userId, sessionId, 'in_progress', occurredAt);
  }

  async cancel(userId: string, sessionId: string, confirm: boolean, occurredAt?: string) {
    if (!confirm) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'confirmation_required',
        'Confirme o cancelamento do treino.',
      );
    }
    return this.close(userId, sessionId, 'aborted', occurredAt);
  }

  async finish(
    userId: string,
    sessionId: string,
    input: { confirmIncomplete: boolean; occurredAt?: string; notes?: string | null },
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      if (isTerminal(session)) {
        throw fail(HttpStatus.CONFLICT, 'session_locked', 'Esta sessão já foi encerrada.');
      }
      const payload = toPayload(session);
      if (!input.confirmIncomplete && hasUnfinishedPlannedSets(payload)) {
        throw fail(
          HttpStatus.CONFLICT,
          'incomplete_session',
          'Ainda há séries planejadas sem conclusão. Confirme para finalizar mesmo assim.',
        );
      }
      const clockAdjusted = await this.lock(
        tx,
        session,
        'completed',
        input.occurredAt,
        input.notes,
      );
      return this.present(tx, sessionId, userId, clockAdjusted);
    });
  }

  async recordSet(
    userId: string,
    sessionId: string,
    input: {
      id: string;
      exerciseSessionId: string;
      plannedSetId?: string | null;
      setIndex?: number;
      repetitions?: number | null;
      load?: string | null;
      loadUnit?: 'kg' | 'lb';
      outcome: 'completed' | 'skipped';
      completedAt?: string;
      notes?: string | null;
    },
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      const exercise = session.exercises.find((item) => item.id === input.exerciseSessionId);
      if (!exercise) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
      }
      const referenced = await tx.performedSet.findUnique({ where: { id: input.id } });
      if (referenced && referenced.exerciseSessionId !== exercise.id) invalidSessionReferences();
      const snapshot = sessionPlanSnapshotSchema.parse(session.planSnapshot);
      const plannedExercise = snapshot.exercises.find(
        (item) => item.id === exercise.planExerciseId,
      );
      const planned = input.plannedSetId
        ? plannedExercise?.sets.find((set) => set.id === input.plannedSetId)
        : undefined;
      if (input.plannedSetId && !planned) invalidSessionReferences();
      const existing = exercise.sets.find((set) => set.id === input.id);
      const stored = encodeLoad(input.load, input.loadUnit);
      const fingerprint = performedSetFingerprint({
        outcome: input.outcome,
        repetitions: input.repetitions ?? null,
        load: stored.entered,
        loadUnit: stored.unit,
        notes: input.notes ?? null,
      });
      if (existing) {
        const current = performedSetFingerprint({
          outcome: existing.outcome,
          repetitions: existing.performedRepetitions,
          load: decimalString(existing.performedLoad),
          loadUnit: existing.performedLoadUnit,
          notes: existing.notes,
        });
        if (current !== fingerprint) {
          throw fail(
            HttpStatus.CONFLICT,
            'set_immutable',
            'Essa série já foi registrada. Use a correção para alterar o resultado.',
          );
        }
        return this.present(tx, sessionId, userId, false);
      }
      if (input.outcome === 'completed' && input.repetitions == null && !stored.entered) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'validation_error',
          'Informe as repetições ou a carga realizada. Peso corporal fica sem carga.',
        );
      }
      const plannedLoad = encodeLoad(planned?.load ?? null, planned?.loadUnit);
      const setIndex =
        input.setIndex ?? exercise.sets.reduce((max, set) => Math.max(max, set.setIndex), 0) + 1;
      if (exercise.sets.some((set) => set.setIndex === setIndex)) {
        throw fail(HttpStatus.CONFLICT, 'set_index_taken', 'Já existe uma série nessa posição.');
      }
      const completed = resolveInstant(input.completedAt, session.startedAt);
      await tx.performedSet.create({
        data: {
          id: input.id,
          exerciseSessionId: exercise.id,
          plannedSetId: planned?.id ?? null,
          setIndex,
          outcome: input.outcome,
          plannedRepetitions: planned?.repetitions ?? null,
          plannedLoad: plannedLoad.entered,
          plannedLoadUnit: plannedLoad.unit,
          plannedLoadKg: plannedLoad.kg,
          performedRepetitions: input.repetitions ?? null,
          performedLoad: stored.entered,
          performedLoadUnit: stored.unit,
          performedLoadKg: stored.kg,
          notes: input.notes ?? null,
          completedAt: completed.at,
        },
      });
      if (exercise.status === 'pending') {
        await tx.exerciseSession.update({
          where: { id: exercise.id },
          data: { status: 'in_progress', startedAt: exercise.startedAt ?? completed.at },
        });
      }
      await tx.workoutSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });
      return this.present(tx, sessionId, userId, completed.clockAdjusted);
    });
  }

  async correctSet(
    userId: string,
    sessionId: string,
    setId: string,
    input: {
      id?: string;
      repetitions?: number | null;
      load?: string | null;
      loadUnit?: 'kg' | 'lb';
      voided?: boolean;
      reason: string;
    },
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      const set = session.exercises
        .flatMap((exercise) => exercise.sets)
        .find((item) => item.id === setId);
      if (!set) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Série não encontrada.');
      }
      const correctionId = input.id ?? randomUUID();
      const referenced = await tx.performedSetCorrection.findUnique({
        where: { id: correctionId },
      });
      if (
        referenced &&
        (referenced.performedSetId !== set.id || referenced.correctedByUserId !== userId)
      )
        invalidSessionReferences();
      const existing = set.corrections.find((correction) => correction.id === correctionId);
      if (existing) {
        return this.present(tx, sessionId, userId, false);
      }
      const stored = encodeLoad(input.load, input.loadUnit);
      const voided = input.voided === true;
      if (!voided && input.repetitions == null && !stored.entered) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'validation_error',
          'Informe as repetições ou a carga da correção.',
        );
      }
      await tx.performedSetCorrection.create({
        data: {
          id: correctionId,
          performedSetId: set.id,
          correctedByUserId: userId,
          performedRepetitions: voided ? null : (input.repetitions ?? null),
          performedLoad: voided ? null : stored.entered,
          performedLoadUnit: voided ? null : stored.unit,
          performedLoadKg: voided ? null : stored.kg,
          voided,
          reason: input.reason,
        },
      });
      await tx.workoutSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });
      return this.present(tx, sessionId, userId, false);
    });
  }

  async completeExercise(userId: string, sessionId: string, exerciseSessionId: string) {
    return this.markExercise(userId, sessionId, exerciseSessionId, 'completed', null);
  }

  async skipExercise(
    userId: string,
    sessionId: string,
    exerciseSessionId: string,
    reason?: string,
  ) {
    return this.markExercise(
      userId,
      sessionId,
      exerciseSessionId,
      'skipped',
      reason?.trim() || 'Pulado',
    );
  }

  async saveFeedback(
    userId: string,
    sessionId: string,
    exerciseSessionId: string,
    input: { perceivedLevel?: number | null; comment?: string | null },
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      const exercise = session.exercises.find((item) => item.id === exerciseSessionId);
      if (!exercise) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
      }
      const perceivedLevel = input.perceivedLevel ?? null;
      const comment = input.comment ?? null;
      if (perceivedLevel == null && !comment) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'validation_error',
          'Informe um comentário ou uma avaliação.',
        );
      }
      if (exercise.feedback) {
        await tx.exerciseFeedback.update({
          where: { id: exercise.feedback.id },
          data: { perceivedLevel, comment, version: { increment: 1 } },
        });
      } else {
        await tx.exerciseFeedback.create({
          data: {
            id: randomUUID(),
            exerciseSessionId: exercise.id,
            userId,
            perceivedLevel,
            comment,
          },
        });
      }
      await tx.workoutSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });
      return this.present(tx, sessionId, userId, false);
    });
  }

  async rest(
    userId: string,
    sessionId: string,
    input: {
      action: 'start' | 'pause' | 'resume' | 'finish';
      occurredAt?: string;
      durationSeconds?: number;
      exerciseSessionId?: string | null;
    },
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      if (input.action === 'start' && input.durationSeconds == null) {
        throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'Informe a duração do descanso.');
      }
      if (
        input.exerciseSessionId &&
        !session.exercises.some((exercise) => exercise.id === input.exerciseSessionId)
      ) {
        invalidSessionReferences();
      }
      const instant = resolveInstant(input.occurredAt, session.startedAt);
      await tx.sessionTimeEvent.create({
        data: {
          id: randomUUID(),
          workoutSessionId: session.id,
          exerciseSessionId: input.exerciseSessionId ?? null,
          kind:
            input.action === 'start'
              ? 'rest_start'
              : input.action === 'pause'
                ? 'rest_pause'
                : input.action === 'resume'
                  ? 'rest_resume'
                  : 'rest_finish',
          occurredAt: instant.at,
          restDurationSeconds: input.action === 'start' ? input.durationSeconds : null,
        },
      });
      await tx.workoutSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });
      return this.present(tx, sessionId, userId, instant.clockAdjusted);
    });
  }

  async summary(userId: string, sessionId: string) {
    const session = await this.present(this.prisma, sessionId, userId, false);
    return { session, summary: sessionSummary(session.payload, new Date().toISOString()) };
  }

  async applyOperation(userId: string, deviceId: string, operation: PushOperation) {
    if (operation.operation !== 'upsert' || operation.entityType !== 'workout_session') {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'unsupported_entity',
        'A sessão sincroniza o treino inteiro. Correções acompanham esse registro.',
      );
    }
    const parsed = sessionSyncPayloadSchema.safeParse(operation.payload);
    if (!parsed.success || parsed.data.id !== operation.entityId) {
      throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'Revise os dados da operação.');
    }
    const payload = JSON.parse(JSON.stringify(parsed.data)) as SessionSyncPayload;
    const hash = sha256(canonicalJsonString(payload));
    if (hash !== operation.payloadHash) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'payload_hash_mismatch',
        'A operação não confere com o conteúdo enviado.',
      );
    }
    // Retry only transactional races. Every retry revalidates references before reading a receipt.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.mergeSynced(userId, deviceId, operation, payload);
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002');
        if (!retryable || attempt >= 2) throw error;
      }
    }
  }

  async resolveConflict(
    userId: string,
    conflictId: string,
    choice: 'keep_server' | 'keep_local' | 'keep_both',
  ) {
    const conflict = await this.prisma.workoutSessionConflict.findFirst({
      where: { id: conflictId, userId },
    });
    if (!conflict) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Conflito não encontrado.');
    }
    if (conflict.status !== 'open') {
      return this.present(this.prisma, conflict.workoutSessionId, userId, false);
    }
    const payload = sessionSyncPayloadSchema.parse(conflict.payload);
    if (choice === 'keep_local' || choice === 'keep_both') {
      await this.mutate(userId, conflict.workoutSessionId, async (tx, session) => {
        await validateSessionReferences(tx, userId, payload, session);
        await this.applyClientCorrections(tx, userId, session, payload);
        if (
          !isTerminal(session) &&
          (payload.status === 'completed' || payload.status === 'aborted')
        ) {
          await this.lock(tx, session, payload.status, payload.endedAt ?? undefined, payload.notes);
        }
        return null;
      });
    }
    await this.prisma.workoutSessionConflict.update({
      where: { id: conflict.id },
      data: { status: choice, resolvedAt: new Date() },
    });
    return this.present(this.prisma, conflict.workoutSessionId, userId, false);
  }

  private async mergeSynced(
    userId: string,
    deviceId: string,
    operation: PushOperation,
    payload: SessionSyncPayload,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        let status: 'applied' | 'conflict' | 'rejected' = 'applied';
        let code: string | undefined;
        const existing = await tx.workoutSession.findUnique({
          where: { id: payload.id },
          include: sessionInclude,
        });
        await validateSessionReferences(tx, userId, payload, existing);
        const device = await tx.device.findFirst({
          where: { id: deviceId, userId },
          select: { id: true },
        });
        if (!device) invalidSessionReferences();
        const receipt = await tx.syncOperation.findUnique({
          where: { idempotencyKey: operation.idempotencyKey },
        });
        if (receipt) {
          if (
            receipt.userId !== userId ||
            receipt.payloadHash !== operation.payloadHash ||
            receipt.entityType !== operation.entityType ||
            receipt.entityId !== operation.entityId ||
            receipt.operation !== operation.operation
          ) {
            return {
              id: operation.id,
              status: 'rejected' as const,
              code: 'idempotency_key_reused',
            };
          }
          return {
            id: operation.id,
            status:
              receipt.status === 'applied'
                ? ('applied' as const)
                : receipt.status === 'conflict'
                  ? ('conflict' as const)
                  : ('rejected' as const),
            ...(receipt.conflictCode ? { code: receipt.conflictCode } : {}),
          };
        }
        if (!existing) {
          const created = await this.createFromSync(tx, userId, payload);
          status = created.status;
          code = created.code;
        } else {
          const merged = await this.mergeExisting(
            tx,
            userId,
            existing,
            payload,
            operation.baseVersion,
          );
          status = merged.status;
          code = merged.code;
        }
        if (status === 'conflict') {
          await tx.workoutSessionConflict.create({
            data: {
              id: operation.id,
              userId,
              workoutSessionId: payload.id,
              baseVersion: operation.baseVersion,
              payload: jsonValue(payload),
              status: 'open',
            },
          });
        }
        await tx.syncOperation.create({
          data: {
            id: operation.id,
            userId,
            deviceId,
            entityType: 'workout_session',
            entityId: payload.id,
            operation: 'upsert',
            idempotencyKey: operation.idempotencyKey,
            payloadHash: operation.payloadHash,
            baseVersion: operation.baseVersion,
            status,
            conflictCode: code,
            appliedAt: status === 'applied' ? new Date() : null,
          },
        });
        return { id: operation.id, status, ...(code ? { code } : {}) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async createFromSync(
    tx: Tx,
    userId: string,
    payload: SessionSyncPayload,
  ): Promise<{ status: 'applied' | 'rejected'; code?: string }> {
    const plan = await tx.workoutPlan.findFirst({
      where: { id: payload.planId, ownerUserId: userId },
    });
    const revision = plan
      ? await tx.workoutPlanRevision.findUnique({
          where: { planId_version: { planId: plan.id, version: payload.planVersion } },
        })
      : null;
    if (!plan || !revision) {
      throw fail(
        HttpStatus.CONFLICT,
        'plan_not_synced',
        'Sincronize a ficha antes de enviar o treino. O treino continua neste aparelho.',
      );
    }
    if (payload.gymId) {
      const gym = await tx.gym.findFirst({ where: { id: payload.gymId, ownerUserId: userId } });
      if (!gym) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
      }
    }
    const open = await tx.workoutSession.findFirst({
      where: { userId, status: { in: ['in_progress', 'paused'] } },
    });
    if (open && (payload.status === 'in_progress' || payload.status === 'paused')) {
      return { status: 'rejected', code: 'session_open' };
    }
    const terminal = payload.status === 'completed' || payload.status === 'aborted';
    const endedAt = terminal ? new Date(payload.endedAt ?? new Date().toISOString()) : null;
    const clock = projectClock(
      { ...payload, endedAt: endedAt?.toISOString() ?? null },
      new Date().toISOString(),
    );
    await tx.workoutSession.create({
      data: {
        id: payload.id,
        userId,
        workoutPlanId: plan.id,
        planVersion: payload.planVersion,
        planNameSnapshot: payload.planSnapshot.name,
        planSnapshot: jsonValue(payload.planSnapshot),
        gymId: payload.gymId,
        gymName: payload.gymName,
        status: payload.status,
        startedAt: new Date(payload.startedAt),
        pausedAt: payload.status === 'paused' ? pausedInstant(payload) : null,
        endedAt,
        durationSeconds: terminal ? clock.activeSeconds : null,
        elapsedSeconds: terminal ? clock.elapsedSeconds : null,
        notes: payload.notes,
        lockedAt: terminal ? (endedAt ?? new Date()) : null,
        version: 1,
      },
    });
    for (const exercise of payload.exerciseSessions) {
      await tx.exerciseSession.create({
        data: {
          id: exercise.id,
          workoutSessionId: payload.id,
          planExerciseId: exercise.planExerciseId,
          exerciseId: exercise.exerciseId,
          exerciseNameSnapshot: exercise.name.slice(0, 160),
          orderIndex: exercise.orderIndex,
          status: exercise.status,
          skipReason: exercise.status === 'skipped' ? exercise.skipReason || 'Pulado' : null,
          plannedRestSeconds: exercise.restSeconds,
          gymName: exercise.gymName,
          equipmentName: exercise.equipmentName,
          machineNumber: exercise.machineNumber,
          startedAt: exercise.status === 'pending' ? null : new Date(payload.startedAt),
          endedAt:
            exercise.status === 'completed' || exercise.status === 'skipped' ? endedAt : null,
        },
      });
    }
    for (const set of payload.performedSets) {
      await insertPerformedSet(tx, set);
    }
    for (const correction of payload.corrections) {
      await insertCorrection(tx, userId, correction);
    }
    for (const feedback of payload.feedback) {
      if (feedback.perceivedLevel == null && !feedback.comment) {
        continue;
      }
      await tx.exerciseFeedback.create({
        data: {
          id: feedback.id,
          exerciseSessionId: feedback.exerciseSessionId,
          userId,
          perceivedLevel: feedback.perceivedLevel,
          comment: feedback.comment,
        },
      });
    }
    for (const event of payload.timeEvents) {
      await tx.sessionTimeEvent.create({
        data: {
          id: event.id,
          workoutSessionId: payload.id,
          exerciseSessionId: event.exerciseSessionId,
          kind: event.kind,
          occurredAt: new Date(event.occurredAt),
          restDurationSeconds: event.restDurationSeconds,
        },
      });
    }
    return { status: 'applied' };
  }

  private async mergeExisting(
    tx: Tx,
    userId: string,
    session: LoadedSession,
    payload: SessionSyncPayload,
    baseVersion: number | null,
  ): Promise<{ status: 'applied' | 'conflict'; code?: string }> {
    const current = toPayload(session);
    const merged = mergePerformedSets(
      current.performedSets.map((set) => ({ ...set, fingerprint: performedSetFingerprint(set) })),
      payload.performedSets.map((set) => ({ ...set, fingerprint: performedSetFingerprint(set) })),
    );
    const knownExercises = new Set(session.exercises.map((exercise) => exercise.id));
    for (const set of merged.accepted) {
      if (!knownExercises.has(set.exerciseSessionId)) {
        continue;
      }
      await insertPerformedSet(tx, set);
    }
    const knownCorrections = new Set(
      session.exercises.flatMap((exercise) =>
        exercise.sets.flatMap((set) => set.corrections.map((item) => item.id)),
      ),
    );
    for (const correction of payload.corrections) {
      if (!knownCorrections.has(correction.id)) {
        const target = session.exercises
          .flatMap((exercise) => exercise.sets)
          .some((set) => set.id === correction.performedSetId);
        const accepted = merged.accepted.some((set) => set.id === correction.performedSetId);
        if (target || accepted) {
          await insertCorrection(tx, userId, correction);
        }
      }
    }
    const knownEvents = new Set(session.timeEvents.map((event) => event.id));
    for (const event of payload.timeEvents) {
      if (!knownEvents.has(event.id)) {
        await tx.sessionTimeEvent.create({
          data: {
            id: event.id,
            workoutSessionId: session.id,
            exerciseSessionId: knownExercises.has(event.exerciseSessionId ?? '')
              ? event.exerciseSessionId
              : null,
            kind: event.kind,
            occurredAt: new Date(event.occurredAt),
            restDurationSeconds: event.restDurationSeconds,
          },
        });
      }
    }
    const versionsMatch = baseVersion != null && baseVersion === session.version;
    if (!isTerminal(session) && versionsMatch) {
      for (const exercise of payload.exerciseSessions) {
        const currentExercise = session.exercises.find((item) => item.id === exercise.id);
        if (!currentExercise || currentExercise.status === exercise.status) {
          continue;
        }
        await tx.exerciseSession.update({
          where: { id: currentExercise.id },
          data: {
            status: exercise.status,
            skipReason: exercise.status === 'skipped' ? exercise.skipReason || 'Pulado' : null,
            endedAt:
              exercise.status === 'completed' || exercise.status === 'skipped' ? new Date() : null,
          },
        });
      }
      if (payload.notes !== session.notes) {
        await tx.workoutSession.update({
          where: { id: session.id },
          data: { notes: payload.notes },
        });
      }
      if (payload.status === 'paused' && session.status === 'in_progress') {
        await tx.workoutSession.update({
          where: { id: session.id },
          data: { status: 'paused', pausedAt: pausedInstant(payload) },
        });
      }
      if (payload.status === 'in_progress' && session.status === 'paused') {
        await tx.workoutSession.update({
          where: { id: session.id },
          data: { status: 'in_progress', pausedAt: null },
        });
      }
      if (
        (payload.status === 'completed' || payload.status === 'aborted') &&
        !isTerminal(session)
      ) {
        await this.lock(tx, session, payload.status, payload.endedAt ?? undefined, payload.notes);
      }
    }
    await tx.workoutSession.update({
      where: { id: session.id },
      data: { version: { increment: 1 } },
    });
    if (merged.divergent.length > 0) {
      return { status: 'conflict', code: 'performed_set_diverged' };
    }
    if (isTerminal(session) && merged.accepted.length > 0) {
      return { status: 'conflict', code: 'session_locked' };
    }
    if (!versionsMatch && session.version !== 1) {
      return { status: 'conflict', code: 'version_mismatch' };
    }
    return { status: 'applied' };
  }

  private async applyClientCorrections(
    tx: Tx,
    userId: string,
    session: LoadedSession,
    payload: SessionSyncPayload,
  ) {
    const current = toPayload(session);
    const merged = mergePerformedSets(
      current.performedSets.map((set) => ({ ...set, fingerprint: performedSetFingerprint(set) })),
      payload.performedSets.map((set) => ({ ...set, fingerprint: performedSetFingerprint(set) })),
    );
    for (const item of merged.divergent) {
      const stored = encodeLoad(item.client.load, item.client.loadUnit ?? undefined);
      await tx.performedSetCorrection.create({
        data: {
          id: randomUUID(),
          performedSetId: item.server.id,
          correctedByUserId: userId,
          performedRepetitions: item.client.repetitions,
          performedLoad: stored.entered,
          performedLoadUnit: stored.unit,
          performedLoadKg: stored.kg,
          voided: false,
          reason: 'Valor preservado na reconciliação.',
        },
      });
    }
  }

  private async transition(
    userId: string,
    sessionId: string,
    target: 'paused' | 'in_progress',
    occurredAt?: string,
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      if (session.status === target) {
        return this.present(tx, sessionId, userId, false);
      }
      if (target === 'paused' && session.status !== 'in_progress') {
        throw fail(
          HttpStatus.CONFLICT,
          'invalid_transition',
          'O treino não pode ser pausado neste estado.',
        );
      }
      if (target === 'in_progress' && session.status !== 'paused') {
        throw fail(HttpStatus.CONFLICT, 'invalid_transition', 'O treino não está pausado.');
      }
      const instant = resolveInstant(occurredAt, session.startedAt);
      await tx.sessionTimeEvent.create({
        data: {
          id: randomUUID(),
          workoutSessionId: session.id,
          kind: target === 'paused' ? 'pause' : 'resume',
          occurredAt: instant.at,
        },
      });
      await tx.workoutSession.update({
        where: { id: session.id },
        data: {
          status: target,
          pausedAt: target === 'paused' ? instant.at : null,
          version: { increment: 1 },
        },
      });
      return this.present(tx, sessionId, userId, instant.clockAdjusted);
    });
  }

  private async close(
    userId: string,
    sessionId: string,
    status: 'completed' | 'aborted',
    occurredAt?: string,
    notes?: string | null,
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      if (isTerminal(session)) {
        throw fail(HttpStatus.CONFLICT, 'session_locked', 'Esta sessão já foi encerrada.');
      }
      const clockAdjusted = await this.lock(tx, session, status, occurredAt, notes);
      return this.present(tx, sessionId, userId, clockAdjusted);
    });
  }

  private async lock(
    tx: Tx,
    session: LoadedSession,
    status: 'completed' | 'aborted',
    occurredAt?: string,
    notes?: string | null,
  ) {
    const instant = resolveInstant(occurredAt, session.startedAt);
    const events = await tx.sessionTimeEvent.findMany({ where: { workoutSessionId: session.id } });
    const payload = toPayload({ ...session, timeEvents: events, endedAt: instant.at });
    const clock = projectClock(payload, instant.at.toISOString());
    await tx.workoutSession.update({
      where: { id: session.id },
      data: {
        status,
        pausedAt: null,
        endedAt: instant.at,
        durationSeconds: clock.activeSeconds,
        elapsedSeconds: clock.elapsedSeconds,
        lockedAt: instant.at,
        notes: notes === undefined ? session.notes : notes,
        version: { increment: 1 },
      },
    });
    return instant.clockAdjusted;
  }

  private async markExercise(
    userId: string,
    sessionId: string,
    exerciseSessionId: string,
    status: 'completed' | 'skipped',
    skipReason: string | null,
  ) {
    return this.mutate(userId, sessionId, async (tx, session) => {
      assertOpen(session);
      const exercise = session.exercises.find((item) => item.id === exerciseSessionId);
      if (!exercise) {
        throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
      }
      if (exercise.status !== status) {
        await tx.exerciseSession.update({
          where: { id: exercise.id },
          data: {
            status,
            skipReason: status === 'skipped' ? skipReason || 'Pulado' : null,
            startedAt: exercise.startedAt ?? new Date(),
            endedAt: new Date(),
          },
        });
        await tx.workoutSession.update({
          where: { id: session.id },
          data: { version: { increment: 1 } },
        });
      }
      return this.present(tx, sessionId, userId, false);
    });
  }

  private async mutate<T>(
    userId: string,
    sessionId: string,
    change: (tx: Tx, session: LoadedSession) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM meutreino.workout_sessions
        WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE`;
        if (locked.length === 0) {
          throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Treino não encontrado.');
        }
        const session = await tx.workoutSession.findFirst({
          where: { id: sessionId, userId },
          include: sessionInclude,
        });
        if (!session) {
          throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Treino não encontrado.');
        }
        return change(tx, session);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async present(
    db: PrismaService | Tx,
    sessionId: string,
    userId: string,
    clockAdjusted: boolean,
  ) {
    const session = await db.workoutSession.findFirst({
      where: { id: sessionId, userId },
      include: sessionInclude,
    });
    if (!session) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Treino não encontrado.');
    }
    const payload = toPayload(session);
    const now = session.endedAt?.toISOString() ?? new Date().toISOString();
    const clock = projectClock(payload, now);
    return {
      payload,
      version: session.version,
      activeSeconds: session.durationSeconds ?? clock.activeSeconds,
      elapsedSeconds: session.elapsedSeconds ?? clock.elapsedSeconds,
      durationSeconds: session.durationSeconds,
      pausedAt: session.pausedAt?.toISOString() ?? null,
      lockedAt: session.lockedAt?.toISOString() ?? null,
      clockAdjusted,
      rest: projectRest(payload.timeEvents, now),
      unfinished: hasUnfinishedPlannedSets(payload),
    };
  }
}

function toPayload(
  session: LoadedSession | (Omit<LoadedSession, 'endedAt'> & { endedAt: Date | null }),
): SessionSyncPayload {
  const snapshot = sessionPlanSnapshotSchema.parse(session.planSnapshot);
  const corrections = session.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      set.corrections.map((correction) => ({
        id: correction.id,
        performedSetId: correction.performedSetId,
        repetitions: correction.performedRepetitions,
        load: decimalString(correction.performedLoad),
        loadUnit: correction.performedLoadUnit,
        voided: correction.voided,
        reason: correction.reason,
        createdAt: correction.createdAt.toISOString(),
      })),
    ),
  );
  return sessionSyncPayloadSchema.parse({
    id: session.id,
    planId: session.workoutPlanId,
    planVersion: session.planVersion,
    planName: session.planNameSnapshot,
    gymId: session.gymId,
    gymName: session.gymName,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    notes: session.notes,
    planSnapshot: snapshot,
    exerciseSessions: session.exercises.map((exercise) => ({
      id: exercise.id,
      planExerciseId: exercise.planExerciseId,
      exerciseId: exercise.exerciseId,
      name: exercise.exerciseNameSnapshot,
      orderIndex: exercise.orderIndex,
      status: exercise.status,
      skipReason: exercise.skipReason,
      gymName: exercise.gymName,
      equipmentName: exercise.equipmentName,
      machineNumber: exercise.machineNumber,
      restSeconds: exercise.plannedRestSeconds,
    })),
    performedSets: session.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => ({
        id: set.id,
        exerciseSessionId: set.exerciseSessionId,
        plannedSetId: set.plannedSetId,
        setIndex: set.setIndex,
        plannedRepetitions: set.plannedRepetitions,
        plannedLoad: decimalString(set.plannedLoad),
        plannedLoadUnit: set.plannedLoadUnit,
        repetitions: set.performedRepetitions,
        load: decimalString(set.performedLoad),
        loadUnit: set.performedLoadUnit,
        outcome: set.outcome,
        completedAt: set.completedAt.toISOString(),
        notes: set.notes,
      })),
    ),
    corrections,
    feedback: session.exercises.flatMap((exercise) =>
      exercise.feedback
        ? [
            {
              id: exercise.feedback.id,
              exerciseSessionId: exercise.id,
              perceivedLevel: exercise.feedback.perceivedLevel,
              comment: exercise.feedback.comment,
            },
          ]
        : [],
    ),
    timeEvents: session.timeEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurredAt: event.occurredAt.toISOString(),
      restDurationSeconds: event.restDurationSeconds,
      exerciseSessionId: event.exerciseSessionId,
    })),
  });
}

async function insertPerformedSet(tx: Tx, set: PerformedSetSync): Promise<void> {
  const performed = encodeLoad(set.load, set.loadUnit ?? undefined);
  const planned = encodeLoad(set.plannedLoad, set.plannedLoadUnit ?? undefined);
  await tx.performedSet.create({
    data: {
      id: set.id,
      exerciseSessionId: set.exerciseSessionId,
      plannedSetId: set.plannedSetId,
      setIndex: set.setIndex,
      outcome: set.outcome,
      plannedRepetitions: set.plannedRepetitions,
      plannedLoad: planned.entered,
      plannedLoadUnit: planned.unit,
      plannedLoadKg: planned.kg,
      performedRepetitions: set.repetitions,
      performedLoad: performed.entered,
      performedLoadUnit: performed.unit,
      performedLoadKg: performed.kg,
      notes: set.notes,
      completedAt: new Date(set.completedAt),
    },
  });
}

async function insertCorrection(
  tx: Tx,
  userId: string,
  correction: PerformedCorrectionSync,
): Promise<void> {
  const stored = encodeLoad(correction.load, correction.loadUnit ?? undefined);
  await tx.performedSetCorrection.create({
    data: {
      id: correction.id,
      performedSetId: correction.performedSetId,
      correctedByUserId: userId,
      performedRepetitions: correction.voided ? null : correction.repetitions,
      performedLoad: correction.voided ? null : stored.entered,
      performedLoadUnit: correction.voided ? null : stored.unit,
      performedLoadKg: correction.voided ? null : stored.kg,
      voided: correction.voided,
      reason: correction.reason,
      createdAt: new Date(correction.createdAt),
    },
  });
}

function encodeLoad(load: string | null | undefined, unit: 'kg' | 'lb' | undefined) {
  if (!load) {
    return { entered: null, unit: null, kg: null };
  }
  const chosen = unit ?? 'kg';
  try {
    return { entered: load, unit: chosen, kg: toCanonicalKilograms(load, chosen) };
  } catch (error) {
    if (error instanceof LoadValueError) {
      throw fail(HttpStatus.BAD_REQUEST, 'validation_error', error.message);
    }
    throw error;
  }
}

function decimalString(value: { toFixed(digits: number): string } | null): string | null {
  return value ? value.toFixed(2) : null;
}

function resolveInstant(value: string | undefined, startedAt: Date, now = new Date()) {
  const requested = value ? new Date(value) : now;
  if (Number.isNaN(requested.getTime())) {
    throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'Horário inválido.');
  }
  let at = requested;
  let clockAdjusted = false;
  if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    at = now;
    clockAdjusted = true;
  }
  if (startedAt.getTime() > 0 && at.getTime() < startedAt.getTime()) {
    at = startedAt;
    clockAdjusted = true;
  }
  return { at, clockAdjusted };
}

function pausedInstant(payload: SessionSyncPayload): Date {
  const pause = [...payload.timeEvents].reverse().find((event) => event.kind === 'pause');
  return new Date(pause?.occurredAt ?? payload.startedAt);
}

function assertOpen(session: { lockedAt: Date | null; status: string }) {
  if (isTerminal(session)) {
    throw fail(HttpStatus.CONFLICT, 'session_locked', 'Esta sessão já foi encerrada.');
  }
}

function isTerminal(session: { lockedAt: Date | null; status: string }): boolean {
  return session.lockedAt != null || session.status === 'completed' || session.status === 'aborted';
}

function isOpenSessionConstraint(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }
  return error instanceof Error && error.message.includes('workout_sessions_one_open_per_user');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
