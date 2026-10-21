import { PASSWORD_MIN_LENGTH, passwordSchema } from '@meutreino/shared';
import type { ZodType } from 'zod';

export function fieldError(schema: ZodType, value: unknown): string | null {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return null;
  }
  return parsed.error.issues[0]?.message ?? 'Revise este campo.';
}

export function passwordConfirmationError(password: string, confirmation: string): string | null {
  if (passwordSchema.safeParse(password).success && password !== confirmation) {
    return 'As senhas não coincidem.';
  }
  return null;
}

export function passwordHint(): string {
  return `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres. Senhas longas e gerenciadores são bem-vindos.`;
}
