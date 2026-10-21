import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newId(): string {
  return randomUUID();
}
