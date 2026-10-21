import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { WorkoutPlanConflictController, WorkoutPlanController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [IdentityModule],
  controllers: [WorkoutPlanController, WorkoutPlanConflictController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
