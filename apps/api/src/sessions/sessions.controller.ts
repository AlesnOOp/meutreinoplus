import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SESSION_STATUSES,
  cancelSessionSchema,
  exerciseFeedbackWriteSchema,
  finishSessionSchema,
  performedSetCorrectionSchema,
  performedSetWriteSchema,
  restActionSchema,
  sessionConflictResolveSchema,
  sessionConflictPreviewSchema,
  sessionMomentSchema,
  skipExerciseSchema,
  startSessionSchema,
} from '@meutreino/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AccessGuard, requireAuth, type AuthenticatedRequest } from '../identity/access.guard';
import { SessionsService } from './sessions.service';

const uuidSchema = z.uuid();
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(SESSION_STATUSES).optional(),
});

@ApiTags('Treinos')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('workout-sessions')
export class WorkoutSessionController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os treinos do usuário autenticado.' })
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.sessions.list(
      requireAuth(request).userId,
      query.page,
      query.pageSize,
      query.status,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Inicia um treino a partir da revisão imutável da ficha.' })
  start(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(startSessionSchema)) body: z.infer<typeof startSessionSchema>,
  ) {
    return this.sessions.start(requireAuth(request).userId, body);
  }

  @Get('open')
  @ApiOperation({ summary: 'Recupera o treino em andamento, se houver.' })
  open(@Req() request: AuthenticatedRequest) {
    return this.sessions.open(requireAuth(request).userId);
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Mostra a sessão e a fotografia da ficha usada no início.' })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
  ) {
    return this.sessions.get(requireAuth(request).userId, sessionId);
  }

  @Get(':sessionId/variants')
  variants(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
  ) {
    return this.sessions.variants(requireAuth(request).userId, sessionId);
  }

  @Get(':sessionId/summary')
  @ApiOperation({ summary: 'Resume o treino com durações, séries e avaliações.' })
  summary(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
  ) {
    return this.sessions.summary(requireAuth(request).userId, sessionId);
  }

  @Post(':sessionId/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pausa o treino e registra o horário.' })
  pause(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(sessionMomentSchema)) body: z.infer<typeof sessionMomentSchema>,
  ) {
    return this.sessions.pause(requireAuth(request).userId, sessionId, body.occurredAt);
  }

  @Post(':sessionId/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retoma o treino a partir do horário registrado.' })
  resume(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(sessionMomentSchema)) body: z.infer<typeof sessionMomentSchema>,
  ) {
    return this.sessions.resume(requireAuth(request).userId, sessionId, body.occurredAt);
  }

  @Post(':sessionId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela o treino. O histórico de séries permanece.' })
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(cancelSessionSchema)) body: z.infer<typeof cancelSessionSchema>,
  ) {
    return this.sessions.cancel(
      requireAuth(request).userId,
      sessionId,
      body.confirm,
      body.occurredAt,
    );
  }

  @Post(':sessionId/finish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finaliza o treino e trava o resultado.' })
  finish(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(finishSessionSchema)) body: z.infer<typeof finishSessionSchema>,
  ) {
    return this.sessions.finish(requireAuth(request).userId, sessionId, body);
  }

  @Post(':sessionId/sets')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra uma série realizada, extra ou pulada.' })
  recordSet(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(performedSetWriteSchema))
    body: z.infer<typeof performedSetWriteSchema>,
  ) {
    return this.sessions.recordSet(requireAuth(request).userId, sessionId, body);
  }

  @Post(':sessionId/sets/:setId/correct')
  @HttpCode(200)
  @ApiOperation({ summary: 'Corrige uma série com um novo evento, sem apagar o original.' })
  correct(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Param('setId', new ZodValidationPipe(uuidSchema)) setId: string,
    @Body(new ZodValidationPipe(performedSetCorrectionSchema))
    body: z.infer<typeof performedSetCorrectionSchema>,
  ) {
    return this.sessions.correctSet(requireAuth(request).userId, sessionId, setId, body);
  }

  @Post(':sessionId/sets/:setId/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desfaz uma marcação acidental sem apagar a série.' })
  undo(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Param('setId', new ZodValidationPipe(uuidSchema)) setId: string,
    @Body(new ZodValidationPipe(performedSetCorrectionSchema))
    body: z.infer<typeof performedSetCorrectionSchema>,
  ) {
    return this.sessions.correctSet(requireAuth(request).userId, sessionId, setId, {
      ...body,
      voided: true,
    });
  }

  @Post(':sessionId/exercises/:exerciseSessionId/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca o exercício como concluído.' })
  completeExercise(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Param('exerciseSessionId', new ZodValidationPipe(uuidSchema)) exerciseSessionId: string,
  ) {
    return this.sessions.completeExercise(
      requireAuth(request).userId,
      sessionId,
      exerciseSessionId,
    );
  }

  @Post(':sessionId/exercises/:exerciseSessionId/skip')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pula o exercício e registra o motivo.' })
  skipExercise(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Param('exerciseSessionId', new ZodValidationPipe(uuidSchema)) exerciseSessionId: string,
    @Body(new ZodValidationPipe(skipExerciseSchema)) body: z.infer<typeof skipExerciseSchema>,
  ) {
    return this.sessions.skipExercise(
      requireAuth(request).userId,
      sessionId,
      exerciseSessionId,
      body.reason,
    );
  }

  @Post(':sessionId/exercises/:exerciseSessionId/feedback')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra comentário e avaliação subjetiva do exercício nesta sessão.' })
  feedback(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Param('exerciseSessionId', new ZodValidationPipe(uuidSchema)) exerciseSessionId: string,
    @Body(new ZodValidationPipe(exerciseFeedbackWriteSchema))
    body: z.infer<typeof exerciseFeedbackWriteSchema>,
  ) {
    return this.sessions.saveFeedback(
      requireAuth(request).userId,
      sessionId,
      exerciseSessionId,
      body,
    );
  }

  @Post(':sessionId/rest')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia, pausa, retoma ou encerra o descanso.' })
  rest(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
    @Body(new ZodValidationPipe(restActionSchema)) body: z.infer<typeof restActionSchema>,
  ) {
    return this.sessions.rest(requireAuth(request).userId, sessionId, body);
  }
}

@ApiTags('Treinos')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('workout-session-conflicts')
export class WorkoutSessionConflictController {
  constructor(private readonly sessions: SessionsService) {}

  @Post(':conflictId/preview')
  @HttpCode(200)
  preview(
    @Req() request: AuthenticatedRequest,
    @Param('conflictId', new ZodValidationPipe(uuidSchema)) conflictId: string,
    @Body(new ZodValidationPipe(sessionConflictPreviewSchema))
    body: z.infer<typeof sessionConflictPreviewSchema>,
  ) {
    return this.sessions.previewConflict(requireAuth(request).userId, conflictId, body);
  }

  @Post(':conflictId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reconcilia um conflito sem apagar séries realizadas.' })
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param('conflictId', new ZodValidationPipe(uuidSchema)) conflictId: string,
    @Body(new ZodValidationPipe(sessionConflictResolveSchema))
    body: z.infer<typeof sessionConflictResolveSchema>,
  ) {
    return this.sessions.resolveConflict(requireAuth(request).userId, conflictId, body);
  }
}
