import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  deleteAccountSchema,
  emailChangeSchema,
  linkIdentitySchema,
  passwordChangeSchema,
  profilePhotoSchema,
  profileUpdateSchema,
  unlinkIdentitySchema,
} from '@meutreino/shared';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AccessGuard, requireAuth, type AuthenticatedRequest } from './access.guard';
import { AccountReader } from './account-reader';
import { AuthService } from './auth.service';
import { DeletionService } from './deletion.service';
import { ExportService } from './export.service';
import { fail } from './http';
import { ProfileService } from './profile.service';
import { HttpStatus } from '@nestjs/common';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly accounts: AccountReader,
    private readonly auth: AuthService,
    private readonly profiles: ProfileService,
    private readonly exports: ExportService,
    private readonly deletion: DeletionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the authenticated account. Subscription is not required.' })
  me(@Req() request: AuthenticatedRequest) {
    return this.accounts.present(requireAuth(request).userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update profile preferences' })
  async updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(profileUpdateSchema))
    body: ReturnType<typeof profileUpdateSchema.parse>,
  ) {
    const auth = requireAuth(request);
    await this.profiles.update(auth.userId, body);
    return this.accounts.present(auth.userId);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend verification for the signed-in account' })
  resend(@Req() request: AuthenticatedRequest) {
    return this.auth.resendForCurrentUser(requireAuth(request).userId);
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke every session of the signed-in account' })
  async logoutAll(@Req() request: AuthenticatedRequest) {
    await this.auth.logoutAll(requireAuth(request).userId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions' })
  sessions(@Req() request: AuthenticatedRequest) {
    const auth = requireAuth(request);
    return this.profiles.listSessions(auth.userId, auth.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke another session owned by the signed-in account' })
  async revokeSession(@Req() request: AuthenticatedRequest, @Param('id') sessionId: string) {
    const auth = requireAuth(request);
    await this.profiles.revokeSession(auth.userId, sessionId, auth.sessionId);
  }

  @Get('identities')
  @ApiOperation({ summary: 'List linked sign-in methods' })
  async identities(@Req() request: AuthenticatedRequest) {
    const account = await this.accounts.present(requireAuth(request).userId);
    return { identities: account.identities };
  }

  @Post('identities/link')
  @ApiOperation({ summary: 'Link Apple or Google after recent reauthentication' })
  link(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(linkIdentitySchema))
    body: ReturnType<typeof linkIdentitySchema.parse>,
  ) {
    return this.auth.linkIdentity(requireAuth(request).userId, body);
  }

  @Delete('identities/:id')
  @ApiOperation({ summary: 'Unlink a sign-in method when another method remains' })
  unlink(
    @Req() request: AuthenticatedRequest,
    @Param('id') identityId: string,
    @Body(new ZodValidationPipe(unlinkIdentitySchema))
    body: ReturnType<typeof unlinkIdentitySchema.parse>,
  ) {
    return this.auth.unlinkIdentity(requireAuth(request).userId, identityId, body.reauthentication);
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change or create the account password' })
  async password(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(passwordChangeSchema))
    body: ReturnType<typeof passwordChangeSchema.parse>,
  ) {
    const auth = requireAuth(request);
    await this.auth.changePasswordKeepingSession(auth.userId, auth.sessionId, body);
  }

  @Post('email')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request an e-mail change' })
  email(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(emailChangeSchema))
    body: ReturnType<typeof emailChangeSchema.parse>,
  ) {
    return this.auth.requestEmailChange(
      requireAuth(request).userId,
      body.email,
      body.reauthentication,
    );
  }

  @Post('photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Store a private profile photo' })
  async photo(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(profilePhotoSchema))
    body: ReturnType<typeof profilePhotoSchema.parse>,
  ) {
    await this.profiles.savePhoto(requireAuth(request).userId, body.contentType, body.dataBase64);
  }

  @Get('photo')
  @ApiOperation({ summary: 'Download the profile photo' })
  async downloadPhoto(@Req() request: AuthenticatedRequest, @Res() response: Response) {
    const photo = await this.profiles.readPhoto(requireAuth(request).userId);
    if (!photo) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Nenhuma foto de perfil.');
    }
    response.setHeader('Content-Type', photo.contentType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(photo.body);
  }

  @Delete('photo')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete the profile photo' })
  async removePhoto(@Req() request: AuthenticatedRequest) {
    await this.profiles.deletePhoto(requireAuth(request).userId);
  }

  @Post('export')
  @HttpCode(201)
  @ApiOperation({ summary: 'Export the personal data that currently exists' })
  async createExport(@Req() request: AuthenticatedRequest) {
    const auth = requireAuth(request);
    const account = await this.accounts.present(auth.userId);
    return this.exports.create(auth.userId, account);
  }

  @Get('export/:id')
  @ApiOperation({ summary: 'Read an export request owned by the signed-in account' })
  exportStatus(@Req() request: AuthenticatedRequest, @Param('id') exportId: string) {
    return this.exports.read(requireAuth(request).userId, exportId);
  }

  @Get('export/:id/download')
  @ApiOperation({ summary: 'Download an export file' })
  async downloadExport(
    @Req() request: AuthenticatedRequest,
    @Param('id') exportId: string,
    @Res() response: Response,
  ) {
    const file = await this.exports.download(requireAuth(request).userId, exportId);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.body);
  }

  @Post('delete-account')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete the account after recent reauthentication' })
  async deleteAccount(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(deleteAccountSchema))
    body: ReturnType<typeof deleteAccountSchema.parse>,
  ) {
    const auth = requireAuth(request);
    await this.auth.confirmReauthentication(auth.userId, body.reauthentication);
    const account = await this.accounts.present(auth.userId);
    await this.auth.notifyDeletion(account.email);
    await this.deletion.purge(auth.userId);
    return { status: 'deleted' };
  }
}
