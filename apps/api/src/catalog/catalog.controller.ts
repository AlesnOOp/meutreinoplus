import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  equipmentWriteSchema,
  exerciseWriteSchema,
  gymWriteSchema,
  profilePhotoSchema,
  syncOperationEnvelopeSchema,
} from '@meutreino/shared';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AccessGuard, requireAuth, type AuthenticatedRequest } from '../identity/access.guard';
import { fail } from '../identity/http';
import { CatalogService } from './catalog.service';
import { SyncApplyService } from './sync.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeArchived: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(80).optional(),
  muscle: z.enum(MUSCLE_GROUPS).optional(),
  equipmentType: z.enum(EQUIPMENT_TYPES).optional(),
});

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw fail(HttpStatus.BAD_REQUEST, 'validation_error', 'Revise os filtros.');
  }
  return parsed.data;
}

const syncPushSchema = z.object({
  operations: z
    .array(
      syncOperationEnvelopeSchema.and(
        z.object({
          payload: z.record(z.string(), z.unknown()),
        }),
      ),
    )
    .max(20),
});

@ApiTags('gyms')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('gyms')
export class GymController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List gyms owned by the signed-in user' })
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseListQuery(query);
    return this.catalog.listGyms(
      requireAuth(request).userId,
      parsed.page,
      parsed.pageSize,
      parsed.includeArchived === 'true',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a private gym' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(gymWriteSchema)) body: ReturnType<typeof gymWriteSchema.parse>,
  ) {
    return this.catalog.createGym(requireAuth(request).userId, body);
  }

  @Get(':gymId')
  @ApiOperation({ summary: 'Read one owned gym' })
  read(@Req() request: AuthenticatedRequest, @Param('gymId') gymId: string) {
    return this.catalog.readGym(requireAuth(request).userId, gymId);
  }

  @Patch(':gymId')
  @ApiOperation({ summary: 'Update an owned gym' })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Body(new ZodValidationPipe(gymWriteSchema)) body: ReturnType<typeof gymWriteSchema.parse>,
  ) {
    return this.catalog.updateGym(requireAuth(request).userId, gymId, body);
  }

  @Post(':gymId/archive')
  @ApiOperation({ summary: 'Archive a gym without deleting its equipment' })
  archive(@Req() request: AuthenticatedRequest, @Param('gymId') gymId: string) {
    return this.catalog.archiveGym(requireAuth(request).userId, gymId);
  }

  @Get(':gymId/equipment')
  @ApiOperation({ summary: 'List equipment in an owned gym' })
  listEquipment(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Query() query: unknown,
  ) {
    const parsed = parseListQuery(query);
    return this.catalog.listEquipment(
      requireAuth(request).userId,
      gymId,
      parsed.page,
      parsed.pageSize,
      parsed.includeArchived === 'true',
    );
  }

  @Post(':gymId/equipment')
  @ApiOperation({ summary: 'Create equipment in an owned gym' })
  createEquipment(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Body(new ZodValidationPipe(equipmentWriteSchema))
    body: ReturnType<typeof equipmentWriteSchema.parse>,
  ) {
    return this.catalog.createEquipment(requireAuth(request).userId, gymId, body);
  }

  @Get(':gymId/equipment/:equipmentId')
  @ApiOperation({ summary: 'Read one piece of equipment' })
  readEquipment(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
  ) {
    return this.catalog.readEquipment(requireAuth(request).userId, gymId, equipmentId);
  }

  @Patch(':gymId/equipment/:equipmentId')
  @ApiOperation({ summary: 'Update equipment and its exercise links' })
  updateEquipment(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
    @Body(new ZodValidationPipe(equipmentWriteSchema))
    body: ReturnType<typeof equipmentWriteSchema.parse>,
  ) {
    return this.catalog.updateEquipment(requireAuth(request).userId, gymId, equipmentId, body);
  }

  @Post(':gymId/equipment/:equipmentId/archive')
  @ApiOperation({ summary: 'Archive equipment and keep historical links' })
  archiveEquipment(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
  ) {
    return this.catalog.archiveEquipment(requireAuth(request).userId, gymId, equipmentId);
  }

  @Post(':gymId/equipment/:equipmentId/photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Store a private equipment photo' })
  async photo(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
    @Body(new ZodValidationPipe(profilePhotoSchema))
    body: ReturnType<typeof profilePhotoSchema.parse>,
  ) {
    await this.catalog.saveEquipmentPhoto(
      requireAuth(request).userId,
      gymId,
      equipmentId,
      body.contentType,
      body.dataBase64,
    );
  }

  @Get(':gymId/equipment/:equipmentId/photo')
  @ApiOperation({ summary: 'Download an equipment photo owned by the signed-in user' })
  async downloadPhoto(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
    @Res() response: Response,
  ) {
    const photo = await this.catalog.readEquipmentPhoto(
      requireAuth(request).userId,
      gymId,
      equipmentId,
    );
    if (!photo) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Nenhuma foto deste equipamento.');
    }
    response.setHeader('Content-Type', photo.contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(photo.body);
  }

  @Delete(':gymId/equipment/:equipmentId/photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an equipment photo' })
  async removePhoto(
    @Req() request: AuthenticatedRequest,
    @Param('gymId') gymId: string,
    @Param('equipmentId') equipmentId: string,
  ) {
    await this.catalog.deleteEquipmentPhoto(requireAuth(request).userId, gymId, equipmentId);
  }
}

@ApiTags('exercises')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('exercises')
export class ExerciseController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Search the exercise library and the signed-in user custom exercises' })
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseListQuery(query);
    return this.catalog.listExercises(requireAuth(request).userId, {
      page: parsed.page,
      pageSize: parsed.pageSize,
      q: parsed.q,
      muscle: parsed.muscle,
      equipmentType: parsed.equipmentType,
      includeArchived: parsed.includeArchived === 'true',
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom exercise' })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(exerciseWriteSchema))
    body: ReturnType<typeof exerciseWriteSchema.parse>,
  ) {
    return this.catalog.createExercise(requireAuth(request).userId, body);
  }

  @Get(':exerciseId')
  @ApiOperation({ summary: 'Read one visible exercise' })
  read(@Req() request: AuthenticatedRequest, @Param('exerciseId') exerciseId: string) {
    return this.catalog.readExercise(requireAuth(request).userId, exerciseId);
  }

  @Patch(':exerciseId')
  @ApiOperation({ summary: 'Update a custom exercise' })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('exerciseId') exerciseId: string,
    @Body(new ZodValidationPipe(exerciseWriteSchema))
    body: ReturnType<typeof exerciseWriteSchema.parse>,
  ) {
    return this.catalog.updateExercise(requireAuth(request).userId, exerciseId, body);
  }

  @Post(':exerciseId/archive')
  @ApiOperation({ summary: 'Archive a custom exercise' })
  archive(@Req() request: AuthenticatedRequest, @Param('exerciseId') exerciseId: string) {
    return this.catalog.archiveExercise(requireAuth(request).userId, exerciseId);
  }
}

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncApplyService,
    private readonly catalog: CatalogService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Apply idempotent gym, equipment, and custom exercise operations' })
  push(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(syncPushSchema)) body: ReturnType<typeof syncPushSchema.parse>,
  ) {
    const auth = requireAuth(request);
    return this.sync.push(auth.userId, auth.sessionId, body.operations);
  }

  @Get('snapshot')
  @ApiOperation({ summary: 'Read the gym, equipment, and exercise snapshot for this account' })
  snapshot(@Req() request: AuthenticatedRequest) {
    return this.catalog.snapshot(requireAuth(request).userId);
  }
}
