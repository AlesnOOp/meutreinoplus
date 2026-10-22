import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rm } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from './crypto';
import { safeJoin } from './storage';

const APPEND_ONLY_TABLES = [
  'consent_records',
  'performed_sets',
  'performed_set_corrections',
  'subscription_events',
  'audit_logs',
  'workout_plan_revisions',
  'plan_revision_origins',
  'session_time_events',
  'workout_session_resolutions',
  'workout_session_variants',
  'exercise_feedback_revisions',
] as const;

const PURGE_GUARDED_TABLES = [...APPEND_ONLY_TABLES, 'exercise_sessions'] as const;

@Injectable()
export class DeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async purge(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'deleted') {
      return;
    }
    const media = await this.prisma.mediaAsset.findMany({ where: { ownerUserId: userId } });
    const exports = await this.prisma.dataExportRequest.findMany({ where: { userId } });
    const now = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        for (const table of PURGE_GUARDED_TABLES) {
          await tx.$executeRawUnsafe(`ALTER TABLE "meutreino"."${table}" DISABLE TRIGGER USER`);
        }
        try {
          await tx.auditLog.updateMany({
            where: { actorUserId: userId },
            data: { actorUserId: null },
          });
          await tx.securityAuditEvent.updateMany({ where: { userId }, data: { userId: null } });

          const sessions = await tx.workoutSession.findMany({
            where: { userId },
            select: { id: true },
          });
          const sessionIds = sessions.map((session) => session.id);
          const exerciseSessions = await tx.exerciseSession.findMany({
            where: { workoutSessionId: { in: sessionIds } },
            select: { id: true },
          });
          const exerciseSessionIds = exerciseSessions.map((session) => session.id);
          await tx.sessionTimeEvent.deleteMany({ where: { workoutSessionId: { in: sessionIds } } });
          await tx.workoutSessionVariant.deleteMany({ where: { resolution: { userId } } });
          await tx.workoutSessionResolution.deleteMany({ where: { userId } });
          await tx.exerciseFeedbackRevision.deleteMany({ where: { feedback: { userId } } });
          await tx.workoutSessionConflict.deleteMany({ where: { userId } });
          await tx.performedSetCorrection.deleteMany({
            where: {
              OR: [
                { correctedByUserId: userId },
                { performedSet: { exerciseSessionId: { in: exerciseSessionIds } } },
              ],
            },
          });
          await tx.exerciseFeedback.deleteMany({ where: { userId } });
          await tx.performedSet.deleteMany({
            where: { exerciseSessionId: { in: exerciseSessionIds } },
          });
          await tx.exerciseSession.deleteMany({ where: { workoutSessionId: { in: sessionIds } } });
          await tx.workoutSession.deleteMany({ where: { userId } });

          await tx.weeklyScheduleSlot.deleteMany({ where: { schedule: { userId } } });
          await tx.weeklySchedule.deleteMany({ where: { userId } });

          const plans = await tx.workoutPlan.findMany({
            where: { ownerUserId: userId },
            select: { id: true },
          });
          const planIds = plans.map((plan) => plan.id);
          await tx.workoutSession.updateMany({
            where: { workoutPlanId: { in: planIds } },
            data: { workoutPlanId: null },
          });
          await tx.weeklyScheduleSlot.deleteMany({ where: { workoutPlanId: { in: planIds } } });
          await tx.workoutPlanConflict.deleteMany({
            where: { OR: [{ userId }, { planId: { in: planIds } }] },
          });
          await tx.planRevisionOrigin.deleteMany({ where: { userId } });
          await tx.workoutPlanRevision.deleteMany({ where: { planId: { in: planIds } } });
          await tx.workoutPlan.updateMany({
            where: { ownerUserId: userId },
            data: { duplicatedFromId: null },
          });
          await tx.workoutPlanSet.deleteMany({
            where: { planExercise: { planId: { in: planIds } } },
          });
          await tx.workoutPlanExercise.deleteMany({ where: { planId: { in: planIds } } });
          await tx.workoutPlan.deleteMany({ where: { ownerUserId: userId } });

          await tx.equipmentExerciseLink.deleteMany({ where: { equipment: { userId } } });
          await tx.workoutSession.updateMany({
            where: { gym: { ownerUserId: userId } },
            data: { gymId: null },
          });
          await tx.equipment.deleteMany({ where: { userId } });
          await tx.userGym.deleteMany({
            where: { OR: [{ userId }, { gym: { ownerUserId: userId } }] },
          });
          await tx.gym.deleteMany({ where: { ownerUserId: userId } });

          const exercises = await tx.exercise.findMany({
            where: { ownerUserId: userId },
            select: { id: true },
          });
          for (const exercise of exercises) {
            const externalPlans = await tx.workoutPlanExercise.count({
              where: { exerciseId: exercise.id, plan: { ownerUserId: { not: userId } } },
            });
            const externalSessions = await tx.exerciseSession.count({
              where: { exerciseId: exercise.id, workoutSession: { userId: { not: userId } } },
            });
            if (externalPlans === 0 && externalSessions === 0) {
              await tx.exercise.delete({ where: { id: exercise.id } });
            } else {
              await tx.exercise.update({
                where: { id: exercise.id },
                data: {
                  namePt: 'Exercício removido',
                  alternativeName: null,
                  instructions: null,
                  visualAssetId: null,
                  deletedAt: now,
                },
              });
            }
          }

          const links = await tx.studentProfessionalLink.findMany({
            where: {
              OR: [
                { studentUserId: userId },
                { professionalUserId: userId },
                { invitedByUserId: userId },
              ],
            },
            select: { id: true },
          });
          await tx.linkPermission.deleteMany({
            where: { linkId: { in: links.map((link) => link.id) } },
          });
          await tx.studentProfessionalLink.deleteMany({
            where: { id: { in: links.map((link) => link.id) } },
          });
          await tx.professionalProfile.deleteMany({ where: { userId } });

          const subscriptions = await tx.subscription.findMany({ where: { userId } });
          for (const subscription of subscriptions) {
            await tx.billingRetentionRecord.create({
              data: {
                formerUserId: userId,
                provider: subscription.provider,
                storeOriginalTransactionId: subscription.storeOriginalTransactionId,
                retainUntil: new Date(now.getTime() + 5 * 365 * 24 * 60 * 60 * 1000),
              },
            });
          }
          await tx.subscriptionEvent.deleteMany({ where: { subscription: { userId } } });
          await tx.subscription.deleteMany({ where: { userId } });

          await tx.syncOperation.deleteMany({ where: { userId } });
          await tx.authSession.deleteMany({ where: { userId } });
          await tx.device.deleteMany({ where: { userId } });
          await tx.emailVerificationToken.deleteMany({ where: { userId } });
          await tx.passwordResetToken.deleteMany({ where: { userId } });
          await tx.emailChangeToken.deleteMany({ where: { userId } });
          await tx.authIdentity.deleteMany({ where: { userId } });
          await tx.consentRecord.deleteMany({ where: { userId } });
          await tx.dataExportRequest.deleteMany({ where: { userId } });
          await tx.userProfile.deleteMany({ where: { userId } });
          await tx.mediaAsset.deleteMany({ where: { ownerUserId: userId } });
          await tx.accountDeletionRequest.create({
            data: {
              userId,
              status: 'completed',
              scheduledPurgeAt: new Date(now.getTime() + 60_000),
              completedAt: now,
            },
          });
          await tx.user.update({
            where: { id: userId },
            data: {
              email: null,
              passwordHash: null,
              status: 'deleted',
              deletedAt: now,
              emailVerifiedAt: null,
            },
          });
        } finally {
          for (const table of PURGE_GUARDED_TABLES) {
            await tx.$executeRawUnsafe(`ALTER TABLE "meutreino"."${table}" ENABLE TRIGGER USER`);
          }
        }
      },
      { timeout: 20_000 },
    );

    await this.removeFiles(
      media.map((asset) => asset.storageKey),
      exports.map((request) => request.storageKey),
    );
    await this.prisma.securityAuditEvent.create({
      data: { eventType: 'account_deleted', outcome: 'success', subjectHash: sha256(userId) },
    });
  }

  private async removeFiles(mediaKeys: string[], exportKeys: Array<string | null>): Promise<void> {
    const mediaRoot = this.config.get<string>('MEDIA_ROOT') ?? 'var/media';
    const exportRoot = this.config.get<string>('EXPORT_ROOT') ?? 'var/exports';
    await Promise.all([
      ...mediaKeys.map((key) => rm(safeJoin(mediaRoot, key), { force: true })),
      ...exportKeys
        .filter((key): key is string => key !== null)
        .map((key) => rm(safeJoin(exportRoot, key), { force: true })),
    ]);
  }
}
