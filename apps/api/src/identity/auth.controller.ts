import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  appleAuthSchema,
  emailRequestSchema,
  googleAuthSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@meutreino/shared';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { sha256 } from './crypto';
import { clientIp } from './http';
import { AuthRateLimiter } from './rate-limit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  @Post('register')
  @HttpCode(202)
  @ApiOperation({ summary: 'Create an account and send a verification e-mail' })
  register(
    @Body(new ZodValidationPipe(registerSchema)) body: ReturnType<typeof registerSchema.parse>,
    @Req() request: Request,
  ) {
    this.limiter.hitRegister(clientIp(request));
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with e-mail and password' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @Req() request: Request,
  ) {
    const subjectHash = sha256(body.email);
    this.limiter.hitLogin(clientIp(request), subjectHash);
    const result = await this.auth.login(body);
    this.limiter.clearLogin(subjectHash);
    return result;
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: ReturnType<typeof refreshSchema.parse>,
  ) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the presented refresh token' })
  async logout(
    @Body(new ZodValidationPipe(logoutSchema)) body: ReturnType<typeof logoutSchema.parse>,
  ) {
    await this.auth.logout(body.refreshToken);
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume an e-mail verification token' })
  verifyEmail(
    @Body(new ZodValidationPipe(tokenSchema)) body: ReturnType<typeof tokenSchema.parse>,
    @Req() request: Request,
  ) {
    this.limiter.hitVerify(clientIp(request));
    return this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send another verification e-mail' })
  resend(
    @Body(new ZodValidationPipe(emailRequestSchema))
    body: ReturnType<typeof emailRequestSchema.parse>,
    @Req() request: Request,
  ) {
    this.limiter.hitResend(sha256(body.email));
    this.limiter.hitRegister(clientIp(request));
    return this.auth.resendVerification(body.email);
  }

  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a password reset e-mail when the account exists' })
  forgot(
    @Body(new ZodValidationPipe(emailRequestSchema))
    body: ReturnType<typeof emailRequestSchema.parse>,
    @Req() request: Request,
  ) {
    this.limiter.hitForgot(clientIp(request));
    return this.auth.forgotPassword(body.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password with a single-use token' })
  reset(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: ReturnType<typeof resetPasswordSchema.parse>,
  ) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Post('apple')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with Apple' })
  apple(
    @Body(new ZodValidationPipe(appleAuthSchema)) body: ReturnType<typeof appleAuthSchema.parse>,
  ) {
    return this.auth.signInWithApple(body);
  }

  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with Google' })
  google(
    @Body(new ZodValidationPipe(googleAuthSchema)) body: ReturnType<typeof googleAuthSchema.parse>,
  ) {
    return this.auth.signInWithGoogle(body);
  }

  @Post('confirm-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a pending e-mail change' })
  confirmEmail(
    @Body(new ZodValidationPipe(tokenSchema)) body: ReturnType<typeof tokenSchema.parse>,
  ) {
    return this.auth.confirmEmailChange(body.token);
  }
}
