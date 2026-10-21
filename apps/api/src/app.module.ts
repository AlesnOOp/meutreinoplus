import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { parseEnv } from './config/env';
import { CatalogModule } from './catalog/catalog.module';
import { PlansModule } from './plans/plans.module';
import { SessionsModule } from './sessions/sessions.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (source: Record<string, unknown>) => parseEnv(source),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV');
        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL') ?? 'info',
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.currentPassword',
                'req.body.newPassword',
                'req.body.passwordHash',
                'req.body.refreshToken',
                'req.body.token',
                'req.body.identityToken',
                'req.body.code',
                'req.body.codeVerifier',
                'req.body.nonce',
                'req.body.dataBase64',
                'req.body.reauthentication',
              ],
              remove: true,
            },
            autoLogging: {
              ignore: (request: IncomingMessage) => request.url?.split('?')[0] === '/api/v1/health',
            },
            genReqId: (request: IncomingMessage, response: ServerResponse) => {
              const incoming = request.headers['x-request-id'];
              const requestId =
                typeof incoming === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(incoming)
                  ? incoming
                  : randomUUID();
              response.setHeader('x-request-id', requestId);
              return requestId;
            },
            transport:
              nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    HealthModule,
    IdentityModule,
    CatalogModule,
    PlansModule,
    SessionsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SecurityHeadersMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
