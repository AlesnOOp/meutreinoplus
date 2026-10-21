import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EXPORT_DOWNLOAD_TTL_SECONDS, type AccountView } from '@meutreino/shared';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from './crypto';
import { fail } from './http';
import { safeJoin } from './storage';

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(
    userId: string,
    account: AccountView,
  ): Promise<{
    id: string;
    status: 'ready';
    requestedAt: string;
    completedAt: string;
    expiresAt: string;
  }> {
    const id = newId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000);
    const storageKey = `${userId}/${id}.json`;
    const payload = await this.payload(userId, account);
    const root = this.config.get<string>('EXPORT_ROOT') ?? 'var/exports';
    const path = safeJoin(root, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
    const request = await this.prisma.dataExportRequest.create({
      data: {
        id,
        userId,
        status: 'ready',
        completedAt: now,
        expiresAt,
        storageKey,
      },
    });
    return {
      id: request.id,
      status: 'ready',
      requestedAt: request.requestedAt.toISOString(),
      completedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async read(userId: string, exportId: string) {
    const request = await this.owned(userId, exportId);
    return {
      id: request.id,
      status:
        request.expiresAt && request.expiresAt.getTime() <= Date.now() ? 'expired' : request.status,
      requestedAt: request.requestedAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
      expiresAt: request.expiresAt?.toISOString() ?? null,
    };
  }

  async download(userId: string, exportId: string): Promise<{ filename: string; body: Buffer }> {
    const request = await this.owned(userId, exportId);
    if (request.status !== 'ready' || !request.storageKey || !request.expiresAt) {
      throw fail(
        HttpStatus.CONFLICT,
        'export_not_ready',
        'A exportação ainda não está disponível.',
      );
    }
    if (request.expiresAt.getTime() <= Date.now()) {
      throw fail(HttpStatus.GONE, 'export_expired', 'A exportação expirou. Solicite outra.');
    }
    const root = this.config.get<string>('EXPORT_ROOT') ?? 'var/exports';
    const body = await readFile(safeJoin(root, request.storageKey));
    return { filename: 'meutreino-dados.json', body };
  }

  private async owned(userId: string, exportId: string) {
    const request = await this.prisma.dataExportRequest.findUnique({ where: { id: exportId } });
    if (!request || request.userId !== userId) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Exportação não encontrada.');
    }
    return request;
  }

  private async payload(userId: string, account: AccountView) {
    const [consents, sessions, photo] = await Promise.all([
      this.prisma.consentRecord.findMany({ where: { userId }, orderBy: { recordedAt: 'asc' } }),
      this.prisma.authSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { device: true },
      }),
      this.prisma.userProfile.findUnique({ where: { userId }, include: { photo: true } }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account,
      consents: consents.map((consent) => ({
        purpose: consent.purpose,
        documentVersion: consent.documentVersion,
        granted: consent.granted,
        recordedAt: consent.recordedAt.toISOString(),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
        deviceLabel: session.deviceLabel,
        platform: session.device?.platform ?? null,
      })),
      profilePhoto: photo?.photo
        ? { contentType: photo.photo.contentType, byteSize: photo.photo.byteSize }
        : null,
    };
  }
}
