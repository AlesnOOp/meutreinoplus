import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService, type AccessContext } from './session.service';

export type AuthenticatedRequest = Request & { auth?: AccessContext };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization') ?? '';
    const match = /^Bearer (\S+)$/.exec(header);
    request.auth = await this.sessions.authenticateAccessToken(match?.[1] ?? '');
    return true;
  }
}

export function requireAuth(request: AuthenticatedRequest): AccessContext {
  if (!request.auth) {
    throw new Error('Access guard did not attach a session.');
  }
  return request.auth;
}
