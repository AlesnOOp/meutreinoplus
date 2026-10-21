import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailModule } from '../email/email.module';
import { AccessGuard } from './access.guard';
import { AccountReader } from './account-reader';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SecurityAuditService } from './audit.service';
import { DeletionService } from './deletion.service';
import { ExportService } from './export.service';
import { HibpPasswordChecker } from './hibp';
import { MeController } from './me.controller';
import { OidcIdentityService, type OidcConfig } from './oidc.service';
import { PasswordService } from './password.service';
import { ProfileService } from './profile.service';
import { AuthRateLimiter } from './rate-limit.service';
import { SessionService } from './session.service';

@Module({
  imports: [EmailModule],
  controllers: [AuthController, MeController],
  providers: [
    PasswordService,
    AuthRateLimiter,
    SecurityAuditService,
    SessionService,
    AccountReader,
    AuthService,
    ProfileService,
    ExportService,
    DeletionService,
    AccessGuard,
    {
      provide: HibpPasswordChecker,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV');
        const mode = nodeEnv === 'test' || nodeEnv === 'development' ? nodeEnv : 'production';
        return new HibpPasswordChecker(mode);
      },
    },
    {
      provide: OidcIdentityService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const oidcConfig: OidcConfig = {
          appleAudiences: readList(config, 'appleAudiences'),
          googleClientIds: readList(config, 'googleClientIds'),
          googleWebClientId: config.get<string>('GOOGLE_WEB_CLIENT_ID') ?? '',
          googleClientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? '',
          googleRedirectUris: readList(config, 'googleRedirectUris'),
        };
        return new OidcIdentityService(oidcConfig);
      },
    },
  ],
  exports: [AccessGuard, SessionService, SecurityAuditService],
})
export class IdentityModule {}

function readList(config: ConfigService, key: string): string[] {
  const value = config.get<string[] | string>(key);
  if (Array.isArray(value)) {
    return value;
  }
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
