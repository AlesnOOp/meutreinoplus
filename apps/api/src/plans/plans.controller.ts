import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  planConflictResolveSchema,
  planCreateSchema,
  planExerciseReplaceSchema,
  planExerciseSchema,
  planExerciseWriteSchema,
  planOrderSchema,
  planSetSchema,
  planSetWriteSchema,
  planSyncPayloadSchema,
  planVersionSchema,
  planWriteSchema,
} from '@meutreino/shared';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AccessGuard, requireAuth, type AuthenticatedRequest } from '../identity/access.guard';
import { PlansService } from './plans.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeArchived: z.enum(['true', 'false']).optional(),
});

const uuidSchema = z.uuid();

@ApiTags('Fichas')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('workout-plans')
export class WorkoutPlanController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as fichas do usuário autenticado.' })
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.plans.list(
      requireAuth(request).userId,
      query.page,
      query.pageSize,
      query.includeArchived === 'true',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma ficha vazia. Não gera treino automaticamente.' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(planCreateSchema)) body: z.infer<typeof planCreateSchema>,
  ) {
    const payload = planSyncPayloadSchema.parse({
      ...body,
      id: body.id ?? randomUUID(),
      status: 'active',
      exercises: [],
    });
    return this.plans.create(requireAuth(request).userId, payload);
  }

  @Get(':planId')
  @ApiOperation({ summary: 'Mostra a ficha atual, com exercícios e séries.' })
  read(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
  ) {
    return this.plans.read(requireAuth(request).userId, planId);
  }

  @Patch(':planId')
  @ApiOperation({ summary: 'Altera nome, descrição ou cor da ficha.' })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Body(new ZodValidationPipe(planWriteSchema.and(planVersionSchema)))
    body: z.infer<typeof planWriteSchema> & z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.updateMeta(requireAuth(request).userId, planId, body.baseVersion, body);
  }

  @Post(':planId/duplicate')
  @ApiOperation({ summary: 'Duplica a ficha com novos identificadores.' })
  duplicate(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
  ) {
    return this.plans.duplicate(requireAuth(request).userId, planId);
  }

  @Post(':planId/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Arquiva a ficha sem apagar o histórico de revisões.' })
  archive(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.archive(requireAuth(request).userId, planId, body.baseVersion);
  }

  @Post(':planId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restaura uma ficha arquivada.' })
  restore(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.restore(requireAuth(request).userId, planId, body.baseVersion);
  }

  @Get(':planId/revisions')
  @ApiOperation({ summary: 'Lista as revisões imutáveis da ficha.' })
  revisions(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
  ) {
    return this.plans.revisions(requireAuth(request).userId, planId);
  }

  @Get(':planId/revisions/:version')
  @ApiOperation({ summary: 'Lê a fotografia de uma versão. Alterações posteriores não a mudam.' })
  revision(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('version', new ZodValidationPipe(z.coerce.number().int().positive())) version: number,
  ) {
    return this.plans.revision(requireAuth(request).userId, planId, version);
  }

  @Put(':planId/exercises/order')
  @ApiOperation({ summary: 'Reordena os exercícios ativos.' })
  reorderExercises(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Body(new ZodValidationPipe(planOrderSchema)) body: z.infer<typeof planOrderSchema>,
  ) {
    return this.plans.reorderExercises(
      requireAuth(request).userId,
      planId,
      body.baseVersion,
      body.orderedIds,
    );
  }

  @Post(':planId/exercises')
  @ApiOperation({ summary: 'Adiciona um exercício do catálogo ou um exercício personalizado.' })
  addExercise(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Body(new ZodValidationPipe(planExerciseWriteSchema))
    body: z.infer<typeof planExerciseWriteSchema>,
  ) {
    const exercise = planExerciseSchema.parse({
      ...body,
      id: body.id ?? randomUUID(),
      orderIndex: 1,
      restSeconds: body.restSeconds ?? null,
      equipment: body.equipment ?? [],
      sets: body.sets ?? [],
    });
    return this.plans.addExercise(requireAuth(request).userId, planId, body.baseVersion, exercise);
  }

  @Patch(':planId/exercises/:planExerciseId')
  @ApiOperation({ summary: 'Edita observações, descanso e equipamento preferencial.' })
  updateExercise(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planExerciseWriteSchema))
    body: z.infer<typeof planExerciseWriteSchema>,
  ) {
    const exercise = planExerciseSchema.parse({
      ...body,
      id: planExerciseId,
      orderIndex: 1,
      restSeconds: body.restSeconds ?? null,
      equipment: body.equipment ?? [],
      sets: body.sets ?? [],
    });
    return this.plans.updateExercise(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
      exercise,
      { replaceSets: body.sets !== undefined, replaceEquipment: body.equipment !== undefined },
    );
  }

  @Post(':planId/exercises/:planExerciseId/replace')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Substitui o exercício e preserva ou redefine as séries, conforme a confirmação.',
  })
  replaceExercise(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planExerciseReplaceSchema))
    body: z.infer<typeof planExerciseReplaceSchema>,
  ) {
    return this.plans.replaceExercise(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
      body.exerciseId,
      body.preserveSets,
    );
  }

  @Post(':planId/exercises/:planExerciseId/duplicate')
  @ApiOperation({ summary: 'Duplica a configuração do exercício, inclusive as séries.' })
  duplicateExercise(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.duplicateExercise(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
    );
  }

  @Delete(':planId/exercises/:planExerciseId')
  @ApiOperation({ summary: 'Retira o exercício da ficha atual sem apagar revisões anteriores.' })
  removeExercise(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.removeExercise(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
    );
  }

  @Put(':planId/exercises/:planExerciseId/sets/order')
  @ApiOperation({ summary: 'Reordena as séries do exercício.' })
  reorderSets(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planOrderSchema)) body: z.infer<typeof planOrderSchema>,
  ) {
    return this.plans.reorderSets(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
      body.orderedIds,
    );
  }

  @Post(':planId/exercises/:planExerciseId/sets')
  @ApiOperation({ summary: 'Adiciona uma série com repetições e carga próprias.' })
  addSet(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Body(new ZodValidationPipe(planSetWriteSchema)) body: z.infer<typeof planSetWriteSchema>,
  ) {
    const set = planSetSchema.parse({ ...body, id: body.id ?? randomUUID(), setIndex: 1 });
    return this.plans.addSet(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      body.baseVersion,
      set,
    );
  }

  @Patch(':planId/exercises/:planExerciseId/sets/:setId')
  @ApiOperation({ summary: 'Edita repetições, carga, unidade ou descanso de uma série.' })
  updateSet(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Param('setId', new ZodValidationPipe(uuidSchema)) setId: string,
    @Body(new ZodValidationPipe(planSetWriteSchema)) body: z.infer<typeof planSetWriteSchema>,
  ) {
    const set = planSetSchema.parse({ ...body, id: setId, setIndex: 1 });
    return this.plans.updateSet(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      setId,
      body.baseVersion,
      set,
    );
  }

  @Post(':planId/exercises/:planExerciseId/sets/:setId/duplicate')
  @ApiOperation({ summary: 'Duplica uma série.' })
  duplicateSet(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Param('setId', new ZodValidationPipe(uuidSchema)) setId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.duplicateSet(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      setId,
      body.baseVersion,
    );
  }

  @Delete(':planId/exercises/:planExerciseId/sets/:setId')
  @ApiOperation({ summary: 'Remove uma série da configuração atual.' })
  removeSet(
    @Req() request: AuthenticatedRequest,
    @Param('planId', new ZodValidationPipe(uuidSchema)) planId: string,
    @Param('planExerciseId', new ZodValidationPipe(uuidSchema)) planExerciseId: string,
    @Param('setId', new ZodValidationPipe(uuidSchema)) setId: string,
    @Body(new ZodValidationPipe(planVersionSchema)) body: z.infer<typeof planVersionSchema>,
  ) {
    return this.plans.removeSet(
      requireAuth(request).userId,
      planId,
      planExerciseId,
      setId,
      body.baseVersion,
    );
  }
}

@ApiTags('Fichas')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('workout-plan-conflicts')
export class WorkoutPlanConflictController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @ApiOperation({ summary: 'Lista conflitos de ficha aguardando revisão.' })
  list(@Req() request: AuthenticatedRequest) {
    return this.plans.listConflicts(requireAuth(request).userId);
  }

  @Post(':conflictId/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Resolve um conflito preservando o servidor, a cópia local ou as duas fichas.',
  })
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('conflictId', new ZodValidationPipe(uuidSchema)) conflictId: string,
    @Body(new ZodValidationPipe(planConflictResolveSchema))
    body: z.infer<typeof planConflictResolveSchema>,
  ) {
    return this.plans.resolveConflict(
      requireAuth(request).userId,
      conflictId,
      body.choice,
      body.payload,
    );
  }
}
