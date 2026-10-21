import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProfileUpdate } from '@meutreino/shared';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from './crypto';
import { fail } from './http';
import { safeJoin } from './storage';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async update(userId: string, input: ProfileUpdate): Promise<void> {
    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        displayName: input.displayName,
        weightUnit: input.weightUnit,
        distanceUnit: input.distanceUnit,
        unitSystem: input.weightUnit === 'kg' ? 'metric' : 'imperial',
        theme: input.theme,
        timeZone: input.timeZone,
        notifyProductEmail: input.notifyProductEmail,
        version: { increment: 1 },
      },
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, replacedById: null },
      include: { device: true },
      orderBy: { lastUsedAt: 'desc' },
    });
    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        current: session.id === currentSessionId,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        deviceLabel: session.deviceLabel,
        platform: session.device?.platform ?? null,
      })),
    };
  }

  async revokeSession(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      throw fail(
        HttpStatus.CONFLICT,
        'current_session',
        'Use sair para encerrar a sessão deste aparelho.',
      );
    }
    const updated = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count !== 1) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Sessão não encontrada.');
    }
  }

  async savePhoto(
    userId: string,
    contentType: 'image/jpeg' | 'image/png' | 'image/webp',
    dataBase64: string,
  ): Promise<void> {
    const bytes = decodePhoto(dataBase64, contentType);
    const id = newId();
    const storageKey = `${userId}/${id}`;
    const root = this.config.get<string>('MEDIA_ROOT') ?? 'var/media';
    const path = safeJoin(root, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { mode: 0o600 });
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.userProfile.findUnique({
          where: { userId },
          include: { photo: true },
        });
        await tx.mediaAsset.create({
          data: {
            id,
            ownerUserId: userId,
            kind: 'profile_photo',
            storageKey,
            contentType,
            byteSize: bytes.length,
          },
        });
        await tx.userProfile.update({ where: { userId }, data: { photoAssetId: id } });
        if (current?.photo) {
          await tx.mediaAsset.update({
            where: { id: current.photo.id },
            data: { deletedAt: new Date() },
          });
        }
      });
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  async readPhoto(userId: string): Promise<{ contentType: string; body: Buffer } | null> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { photo: true },
    });
    if (!profile?.photo || profile.photo.deletedAt) {
      return null;
    }
    const root = this.config.get<string>('MEDIA_ROOT') ?? 'var/media';
    const body = await readFile(safeJoin(root, profile.photo.storageKey));
    return { contentType: profile.photo.contentType, body };
  }

  async deletePhoto(userId: string): Promise<void> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      include: { photo: true },
    });
    if (!profile?.photo) {
      return;
    }
    const storageKey = profile.photo.storageKey;
    await this.prisma.$transaction([
      this.prisma.userProfile.update({ where: { userId }, data: { photoAssetId: null } }),
      this.prisma.mediaAsset.update({
        where: { id: profile.photo.id },
        data: { deletedAt: new Date() },
      }),
    ]);
    const root = this.config.get<string>('MEDIA_ROOT') ?? 'var/media';
    await rm(safeJoin(root, storageKey), { force: true });
  }
}

function decodePhoto(dataBase64: string, contentType: string): Buffer {
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES || !magicMatches(bytes, contentType)) {
    throw fail(
      HttpStatus.BAD_REQUEST,
      'invalid_photo',
      'Envie uma imagem JPEG, PNG ou WebP de até 5 MB.',
    );
  }
  return bytes;
}

function magicMatches(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  return (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
