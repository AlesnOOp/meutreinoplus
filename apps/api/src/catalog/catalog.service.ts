import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type {
  EquipmentType,
  EquipmentView,
  EquipmentWrite,
  ExerciseView,
  ExerciseWrite,
  GymView,
  GymWrite,
  MuscleGroup,
} from '@meutreino/shared';
import type { Prisma } from '../generated/prisma/client';
import { SecurityAuditService } from '../identity/audit.service';
import { fail } from '../identity/http';
import { PrismaService } from '../prisma/prisma.service';
import { decodeImage } from './images';
import { ObjectStorage } from './object-storage';

const exerciseInclude = {
  muscles: true,
  equipmentRequirements: true,
} satisfies Prisma.ExerciseInclude;

type ExerciseRow = Prisma.ExerciseGetPayload<{ include: typeof exerciseInclude }>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: SecurityAuditService,
    private readonly storage: ObjectStorage,
  ) {}

  async listGyms(
    userId: string,
    page: number,
    pageSize: number,
    includeArchived: boolean,
  ): Promise<{
    items: GymView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const where = {
      ownerUserId: userId,
      ...(includeArchived ? {} : { status: 'active' as const }),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.gym.count({ where }),
      this.prisma.gym.findMany({
        where,
        orderBy: [{ isPreferred: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(presentGym), page, pageSize, total };
  }

  async createGym(userId: string, input: GymWrite): Promise<GymView> {
    const gym = await this.prisma.$transaction(async (tx) => {
      if (input.isPreferred) {
        await tx.gym.updateMany({
          where: { ownerUserId: userId, isPreferred: true },
          data: { isPreferred: false },
        });
      }
      const created = await tx.gym.create({
        data: {
          ownerUserId: userId,
          name: input.name,
          nickname: input.nickname ?? null,
          branchName: input.branchName ?? null,
          city: input.city ?? null,
          notes: input.notes ?? null,
          isPreferred: input.isPreferred ?? false,
          memberships: { create: { userId, role: 'owner' } },
        },
      });
      return created;
    });
    await this.audit.record({ userId, eventType: 'gym_created', outcome: 'success' });
    return presentGym(gym);
  }

  async readGym(userId: string, gymId: string): Promise<GymView> {
    return presentGym(await this.ownedGym(userId, gymId));
  }

  async updateGym(userId: string, gymId: string, input: GymWrite): Promise<GymView> {
    await this.ownedGym(userId, gymId);
    const gym = await this.prisma.$transaction(async (tx) => {
      if (input.isPreferred) {
        await tx.gym.updateMany({
          where: { ownerUserId: userId, isPreferred: true, NOT: { id: gymId } },
          data: { isPreferred: false },
        });
      }
      return tx.gym.update({
        where: { id: gymId },
        data: {
          name: input.name,
          nickname: input.nickname ?? null,
          branchName: input.branchName ?? null,
          city: input.city ?? null,
          notes: input.notes ?? null,
          isPreferred: input.isPreferred ?? false,
          version: { increment: 1 },
        },
      });
    });
    await this.audit.record({ userId, eventType: 'gym_updated', outcome: 'success' });
    return presentGym(gym);
  }

  async archiveGym(userId: string, gymId: string): Promise<GymView> {
    await this.ownedGym(userId, gymId);
    const gym = await this.prisma.gym.update({
      where: { id: gymId },
      data: { status: 'archived', isPreferred: false, version: { increment: 1 } },
    });
    await this.audit.record({ userId, eventType: 'gym_archived', outcome: 'success' });
    return presentGym(gym);
  }

  async listEquipment(
    userId: string,
    gymId: string,
    page: number,
    pageSize: number,
    includeArchived: boolean,
  ) {
    await this.ownedGym(userId, gymId);
    const where = { userId, gymId, ...(includeArchived ? {} : { status: 'active' as const }) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.equipment.count({ where }),
      this.prisma.equipment.findMany({
        where,
        include: { exerciseLinks: true, photo: true },
        orderBy: [{ machineNumber: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(presentEquipment), page, pageSize, total };
  }

  async createEquipment(
    userId: string,
    gymId: string,
    input: EquipmentWrite,
  ): Promise<EquipmentView> {
    await this.ownedGym(userId, gymId);
    await this.assertExercisesVisible(userId, input.exerciseIds ?? []);
    const equipment = await this.prisma.equipment.create({
      data: {
        userId,
        gymId,
        name: input.name,
        machineNumber: input.machineNumber ?? null,
        nickname: input.nickname ?? null,
        notes: input.notes ?? null,
        exerciseLinks: { create: (input.exerciseIds ?? []).map((exerciseId) => ({ exerciseId })) },
      },
      include: { exerciseLinks: true, photo: true },
    });
    await this.audit.record({ userId, eventType: 'equipment_created', outcome: 'success' });
    return presentEquipment(equipment);
  }

  async readEquipment(userId: string, gymId: string, equipmentId: string): Promise<EquipmentView> {
    return presentEquipment(await this.ownedEquipment(userId, gymId, equipmentId));
  }

  async updateEquipment(
    userId: string,
    gymId: string,
    equipmentId: string,
    input: EquipmentWrite,
  ): Promise<EquipmentView> {
    await this.ownedEquipment(userId, gymId, equipmentId);
    await this.assertExercisesVisible(userId, input.exerciseIds ?? []);
    const equipment = await this.prisma.$transaction(async (tx) => {
      await tx.equipmentExerciseLink.deleteMany({ where: { equipmentId } });
      return tx.equipment.update({
        where: { id: equipmentId },
        data: {
          name: input.name,
          machineNumber: input.machineNumber ?? null,
          nickname: input.nickname ?? null,
          notes: input.notes ?? null,
          version: { increment: 1 },
          exerciseLinks: {
            create: (input.exerciseIds ?? []).map((exerciseId) => ({ exerciseId })),
          },
        },
        include: { exerciseLinks: true, photo: true },
      });
    });
    await this.audit.record({ userId, eventType: 'equipment_updated', outcome: 'success' });
    return presentEquipment(equipment);
  }

  async archiveEquipment(
    userId: string,
    gymId: string,
    equipmentId: string,
  ): Promise<EquipmentView> {
    await this.ownedEquipment(userId, gymId, equipmentId);
    const equipment = await this.prisma.equipment.update({
      where: { id: equipmentId },
      data: { status: 'archived', version: { increment: 1 } },
      include: { exerciseLinks: true, photo: true },
    });
    await this.audit.record({ userId, eventType: 'equipment_archived', outcome: 'success' });
    return presentEquipment(equipment);
  }

  async saveEquipmentPhoto(
    userId: string,
    gymId: string,
    equipmentId: string,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
    dataBase64: string,
  ): Promise<void> {
    const current = await this.ownedEquipment(userId, gymId, equipmentId);
    const bytes = decodeImage(dataBase64, contentType);
    const assetId = crypto.randomUUID();
    const storageKey = `${userId}/equipment/${assetId}`;
    await this.storage.put(storageKey, bytes);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset.create({
          data: {
            id: assetId,
            ownerUserId: userId,
            kind: 'equipment_photo',
            storageKey,
            contentType,
            byteSize: bytes.length,
          },
        });
        await tx.equipment.update({
          where: { id: equipmentId },
          data: { photoAssetId: assetId, version: { increment: 1 } },
        });
        if (current.photoAssetId) {
          await tx.mediaAsset.update({
            where: { id: current.photoAssetId },
            data: { deletedAt: new Date() },
          });
        }
      });
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
    if (current.photo?.storageKey) {
      await this.storage.remove(current.photo.storageKey);
    }
    await this.audit.record({ userId, eventType: 'equipment_photo_replaced', outcome: 'success' });
  }

  async readEquipmentPhoto(
    userId: string,
    gymId: string,
    equipmentId: string,
  ): Promise<{ contentType: string; body: Buffer } | null> {
    const equipment = await this.ownedEquipment(userId, gymId, equipmentId);
    if (!equipment.photo || equipment.photo.deletedAt || equipment.photo.ownerUserId !== userId) {
      return null;
    }
    const body = await this.storage.read(equipment.photo.storageKey);
    return { contentType: equipment.photo.contentType, body };
  }

  async deleteEquipmentPhoto(userId: string, gymId: string, equipmentId: string): Promise<void> {
    const equipment = await this.ownedEquipment(userId, gymId, equipmentId);
    if (!equipment.photo) {
      return;
    }
    const storageKey = equipment.photo.storageKey;
    await this.prisma.$transaction([
      this.prisma.equipment.update({
        where: { id: equipmentId },
        data: { photoAssetId: null, version: { increment: 1 } },
      }),
      this.prisma.mediaAsset.update({
        where: { id: equipment.photo.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    await this.storage.remove(storageKey);
    await this.audit.record({ userId, eventType: 'equipment_photo_removed', outcome: 'success' });
  }

  async listExercises(userId: string, query: ExerciseQuery) {
    const where = exerciseWhere(userId, query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.exercise.count({ where }),
      this.prisma.exercise.findMany({
        where,
        include: exerciseInclude,
        orderBy: { namePt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => presentExercise(row, userId)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async readExercise(userId: string, exerciseId: string): Promise<ExerciseView> {
    const row = await this.visibleExercise(userId, exerciseId);
    return presentExercise(row, userId);
  }

  async createExercise(userId: string, input: ExerciseWrite): Promise<ExerciseView> {
    const row = await this.writeExercise(userId, null, input);
    await this.audit.record({ userId, eventType: 'exercise_created', outcome: 'success' });
    return presentExercise(row, userId);
  }

  async updateExercise(
    userId: string,
    exerciseId: string,
    input: ExerciseWrite,
  ): Promise<ExerciseView> {
    const current = await this.visibleExercise(userId, exerciseId);
    if (current.origin !== 'user' || current.ownerUserId !== userId) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'system_exercise',
        'Exercícios da biblioteca geral não podem ser editados.',
      );
    }
    const row = await this.writeExercise(userId, exerciseId, input);
    await this.audit.record({ userId, eventType: 'exercise_updated', outcome: 'success' });
    return presentExercise(row, userId);
  }

  async archiveExercise(userId: string, exerciseId: string): Promise<ExerciseView> {
    const current = await this.visibleExercise(userId, exerciseId);
    if (current.origin !== 'user' || current.ownerUserId !== userId) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'system_exercise',
        'Exercícios da biblioteca geral não podem ser arquivados.',
      );
    }
    const row = await this.prisma.exercise.update({
      where: { id: exerciseId },
      data: { status: 'archived', version: { increment: 1 } },
      include: exerciseInclude,
    });
    await this.audit.record({ userId, eventType: 'exercise_archived', outcome: 'success' });
    return presentExercise(row, userId);
  }

  async snapshot(
    userId: string,
  ): Promise<{ gyms: GymView[]; equipment: EquipmentView[]; exercises: ExerciseView[] }> {
    const [gyms, equipment, exercises] = await Promise.all([
      this.prisma.gym.findMany({ where: { ownerUserId: userId }, orderBy: { name: 'asc' } }),
      this.prisma.equipment.findMany({
        where: { userId },
        include: { exerciseLinks: true, photo: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.exercise.findMany({
        where: {
          OR: [
            { origin: 'system', status: 'active' },
            { origin: 'user', ownerUserId: userId },
          ],
        },
        include: exerciseInclude,
        orderBy: { namePt: 'asc' },
      }),
    ]);
    return {
      gyms: gyms.map(presentGym),
      equipment: equipment.map(presentEquipment),
      exercises: exercises.map((row) => presentExercise(row, userId)),
    };
  }

  private async writeExercise(userId: string, exerciseId: string | null, input: ExerciseWrite) {
    const secondary = [
      ...new Set(input.secondaryMuscles.filter((muscle) => muscle !== input.primaryMuscle)),
    ];
    const equipmentTypes = [...new Set(input.equipmentTypes)];
    return this.prisma.$transaction(async (tx) => {
      const id = exerciseId ?? crypto.randomUUID();
      if (exerciseId) {
        await tx.exerciseMuscle.deleteMany({ where: { exerciseId } });
        await tx.exerciseEquipmentRequirement.deleteMany({ where: { exerciseId } });
        await tx.exercise.update({
          where: { id: exerciseId },
          data: {
            namePt: input.namePt,
            alternativeName: input.alternativeName ?? null,
            activityType: input.activityType,
            description: input.description ?? null,
            instructions: input.instructions ?? null,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.exercise.create({
          data: {
            id,
            origin: 'user',
            ownerUserId: userId,
            namePt: input.namePt,
            alternativeName: input.alternativeName ?? null,
            activityType: input.activityType,
            description: input.description ?? null,
            instructions: input.instructions ?? null,
          },
        });
      }
      await tx.exerciseMuscle.createMany({
        data: [
          { exerciseId: id, muscleGroup: input.primaryMuscle, role: 'primary' },
          ...secondary.map((muscleGroup) => ({
            exerciseId: id,
            muscleGroup,
            role: 'secondary' as const,
          })),
        ],
      });
      if (equipmentTypes.length > 0) {
        await tx.exerciseEquipmentRequirement.createMany({
          data: equipmentTypes.map((equipmentType) => ({ exerciseId: id, equipmentType })),
        });
      }
      return tx.exercise.findUniqueOrThrow({ where: { id }, include: exerciseInclude });
    });
  }

  private async ownedGym(userId: string, gymId: string) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, ownerUserId: userId } });
    if (!gym) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Academia não encontrada.');
    }
    return gym;
  }

  private async ownedEquipment(userId: string, gymId: string, equipmentId: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id: equipmentId, gymId, userId },
      include: { exerciseLinks: true, photo: true },
    });
    if (!equipment) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Equipamento não encontrado.');
    }
    return equipment;
  }

  private async visibleExercise(userId: string, exerciseId: string) {
    const exercise = await this.prisma.exercise.findFirst({
      where: {
        id: exerciseId,
        OR: [{ origin: 'system' }, { origin: 'user', ownerUserId: userId }],
      },
      include: exerciseInclude,
    });
    if (!exercise) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
    }
    return exercise;
  }

  private async assertExercisesVisible(userId: string, exerciseIds: string[]): Promise<void> {
    if (exerciseIds.length === 0) {
      return;
    }
    const count = await this.prisma.exercise.count({
      where: {
        id: { in: exerciseIds },
        status: 'active',
        OR: [{ origin: 'system' }, { origin: 'user', ownerUserId: userId }],
      },
    });
    if (count !== new Set(exerciseIds).size) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exercício não encontrado.');
    }
  }
}

export type ExerciseQuery = {
  page: number;
  pageSize: number;
  q?: string;
  muscle?: MuscleGroup;
  equipmentType?: EquipmentType;
  includeArchived: boolean;
};

function exerciseWhere(userId: string, query: ExerciseQuery): Prisma.ExerciseWhereInput {
  return {
    AND: [
      { OR: [{ origin: 'system' }, { origin: 'user', ownerUserId: userId }] },
      query.includeArchived ? {} : { status: 'active' },
      query.q
        ? {
            OR: [
              { namePt: { contains: query.q, mode: 'insensitive' } },
              { alternativeName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {},
      query.muscle ? { muscles: { some: { muscleGroup: query.muscle, role: 'primary' } } } : {},
      query.equipmentType
        ? { equipmentRequirements: { some: { equipmentType: query.equipmentType } } }
        : {},
    ],
  };
}

function presentGym(gym: {
  id: string;
  name: string;
  nickname: string | null;
  branchName: string | null;
  city: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  isPreferred: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}): GymView {
  return {
    id: gym.id,
    name: gym.name,
    nickname: gym.nickname,
    branchName: gym.branchName,
    city: gym.city,
    notes: gym.notes,
    status: gym.status,
    isPreferred: gym.isPreferred,
    version: gym.version,
    createdAt: gym.createdAt.toISOString(),
    updatedAt: gym.updatedAt.toISOString(),
  };
}

function presentEquipment(equipment: {
  id: string;
  gymId: string;
  name: string;
  machineNumber: string | null;
  nickname: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  version: number;
  createdAt: Date;
  updatedAt: Date;
  photoAssetId?: string | null;
  photo?: { deletedAt: Date | null } | null;
  exerciseLinks: { exerciseId: string }[];
}): EquipmentView {
  return {
    id: equipment.id,
    gymId: equipment.gymId,
    name: equipment.name,
    machineNumber: equipment.machineNumber,
    nickname: equipment.nickname,
    notes: equipment.notes,
    status: equipment.status,
    hasPhoto: Boolean(equipment.photo && !equipment.photo.deletedAt),
    exerciseIds: equipment.exerciseLinks.map((link) => link.exerciseId),
    version: equipment.version,
    createdAt: equipment.createdAt.toISOString(),
    updatedAt: equipment.updatedAt.toISOString(),
  };
}

function presentExercise(exercise: ExerciseRow, userId: string): ExerciseView {
  const primary = exercise.muscles.find((muscle) => muscle.role === 'primary');
  return {
    id: exercise.id,
    origin: exercise.origin,
    namePt: exercise.namePt,
    alternativeName: exercise.alternativeName,
    activityType: exercise.activityType,
    description: exercise.description,
    instructions: exercise.instructions,
    primaryMuscle: primary?.muscleGroup ?? null,
    secondaryMuscles: exercise.muscles
      .filter((muscle) => muscle.role === 'secondary')
      .map((muscle) => muscle.muscleGroup),
    equipmentTypes: exercise.equipmentRequirements.map((item) => item.equipmentType),
    status: exercise.status,
    editable: exercise.origin === 'user' && exercise.ownerUserId === userId,
    version: exercise.version,
  };
}
