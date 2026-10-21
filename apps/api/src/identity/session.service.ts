import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpStatus } from '@nestjs/common';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_ABSOLUTE_TTL_SECONDS,
  REFRESH_IDLE_TTL_SECONDS,
  classifyRefresh,
  type DeviceInput,
  type SessionTokens,
} from '@meutreino/shared';
import { SignJWT, jwtVerify } from 'jose';
import { newId, randomToken, sha256 } from './crypto';
import { fail } from './http';
import { SecurityAuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type AccessContext = {
  userId: string;
  sessionId: string;
};

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: SecurityAuditService,
  ) {}

  async open(input: {
    userId: string;
    emailVerified: boolean;
    device: DeviceInput;
  }): Promise<SessionTokens> {
    const now = new Date();
    const sessionId = newId();
    const refreshToken = randomToken();
    const expiresAt = new Date(now.getTime() + REFRESH_ABSOLUTE_TTL_SECONDS * 1000);
    const device = await this.prisma.device.upsert({
      where: {
        userId_installationId: {
          userId: input.userId,
          installationId: input.device.installationId,
        },
      },
      create: {
        userId: input.userId,
        installationId: input.device.installationId,
        platform: input.device.platform,
        appVersion: input.device.appVersion,
      },
      update: {
        platform: input.device.platform,
        appVersion: input.device.appVersion,
        lastSeenAt: now,
      },
    });
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: input.userId,
        deviceId: device.id,
        refreshTokenHash: sha256(refreshToken),
        familyId: newId(),
        expiresAt,
        lastUsedAt: now,
        deviceLabel: input.device.label ?? null,
      },
    });
    return this.tokens(input.userId, sessionId, refreshToken, expiresAt);
  }

  async rotate(refreshToken: string): Promise<SessionTokens> {
    const now = new Date();
    const current = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    const decision = classifyRefresh({
      session: current
        ? {
            revokedAt: current.revokedAt?.toISOString() ?? null,
            replacedById: current.replacedById,
            expiresAt: current.expiresAt.toISOString(),
            lastUsedAt: current.lastUsedAt.toISOString(),
          }
        : null,
      now,
      idleMs: REFRESH_IDLE_TTL_SECONDS * 1000,
    });

    if (decision === 'unknown') {
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_refresh_token', 'A sessão não é mais válida.');
    }
    if (decision === 'reuse') {
      await this.revokeFamily(current?.familyId ?? '');
      await this.audit.record({
        userId: current?.userId,
        eventType: 'refresh_reused',
        outcome: 'failure',
      });
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'refresh_token_reused',
        'A sessão foi encerrada por segurança.',
      );
    }
    if (decision === 'expired' && current) {
      await this.prisma.authSession.update({
        where: { id: current.id },
        data: { revokedAt: now },
      });
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'refresh_token_expired',
        'A sessão expirou. Entre novamente.',
      );
    }
    if (!current) {
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_refresh_token', 'A sessão não é mais válida.');
    }

    const nextId = newId();
    const nextToken = randomToken();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.authSession.updateMany({
        where: { id: current.id, revokedAt: null, replacedById: null },
        data: { revokedAt: now, replacedById: nextId },
      });
      if (updated.count !== 1) {
        return false;
      }
      await tx.authSession.create({
        data: {
          id: nextId,
          userId: current.userId,
          deviceId: current.deviceId,
          refreshTokenHash: sha256(nextToken),
          familyId: current.familyId,
          expiresAt: current.expiresAt,
          lastUsedAt: now,
          deviceLabel: current.deviceLabel,
        },
      });
      return true;
    });
    if (!claimed) {
      await this.revokeFamily(current.familyId);
      await this.audit.record({
        userId: current.userId,
        eventType: 'refresh_reused',
        outcome: 'failure',
      });
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'refresh_token_reused',
        'A sessão foi encerrada por segurança.',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: current.userId } });
    if (!user || user.status === 'deleted') {
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_refresh_token', 'A sessão não é mais válida.');
    }
    await this.audit.record({
      userId: user.id,
      eventType: 'refresh_succeeded',
      outcome: 'success',
    });
    return this.tokens(user.id, nextId, nextToken, current.expiresAt);
  }

  async authenticateAccessToken(token: string): Promise<AccessContext> {
    try {
      const { payload } = await jwtVerify(token, this.secret(), {
        issuer: 'meutreino-api',
        audience: 'meutreino-mobile',
      });
      if (
        payload.purpose !== 'access' ||
        typeof payload.sid !== 'string' ||
        typeof payload.sub !== 'string'
      ) {
        throw new Error('claims');
      }
      const session = await this.prisma.authSession.findFirst({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, status: { not: 'deleted' }, deletedAt: null },
      });
      if (!session || !user) {
        throw new Error('session');
      }
      return { userId: user.id, sessionId: session.id };
    } catch (error) {
      if (error instanceof Error && error.name === 'HttpException') {
        throw error;
      }
      throw fail(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Autenticação necessária.');
    }
  }

  async revokeCurrent(sessionId: string, userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ userId, eventType: 'logout', outcome: 'success' });
  }

  async revokePresented(refreshToken: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session || session.revokedAt) {
      return;
    }
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ userId: session.userId, eventType: 'logout', outcome: 'success' });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ userId, eventType: 'logout_all', outcome: 'success' });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    if (!familyId) {
      return;
    }
    await this.prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async tokens(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<SessionTokens> {
    const accessToken = await new SignJWT({ sid: sessionId, purpose: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('meutreino-api')
      .setAudience('meutreino-mobile')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret());
    const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  private secret(): Uint8Array {
    const value = this.config.get<string>('accessTokenSecret');
    if (!value) {
      throw new Error('AUTH_ACCESS_TOKEN_SECRET is not configured.');
    }
    return new TextEncoder().encode(value);
  }
}
