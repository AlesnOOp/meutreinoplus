import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

export function fail(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status);
}

export function clientIp(request: Request): string {
  const address = request.ip || request.socket.remoteAddress || 'unknown';
  return address.slice(0, 64);
}
