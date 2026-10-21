import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { WorkoutSessionConflictController, WorkoutSessionController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [IdentityModule],
  controllers: [WorkoutSessionController, WorkoutSessionConflictController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
