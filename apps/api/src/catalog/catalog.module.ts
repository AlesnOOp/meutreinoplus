import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityModule } from '../identity/identity.module';
import { PlansModule } from '../plans/plans.module';
import { SessionsModule } from '../sessions/sessions.module';
import { CatalogService } from './catalog.service';
import { ExerciseController, GymController, SyncController } from './catalog.controller';
import { LocalObjectStorage, ObjectStorage } from './object-storage';
import { SyncApplyService } from './sync.service';

@Module({
  imports: [IdentityModule, PlansModule, SessionsModule],
  controllers: [GymController, ExerciseController, SyncController],
  providers: [
    CatalogService,
    SyncApplyService,
    {
      provide: ObjectStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new LocalObjectStorage(config.get<string>('MEDIA_ROOT') ?? 'var/media'),
    },
  ],
})
export class CatalogModule {}
