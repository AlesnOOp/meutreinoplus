import { z } from 'zod';
import { parseCorsOrigins, resolveCorsOrigins } from './cors';

export const DEV_ACCESS_TOKEN_SECRET = 'development-only-access-token-secret-32';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .trim()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a PostgreSQL connection string.',
    ),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AUTH_ACCESS_TOKEN_SECRET: z.string().optional(),
  EMAIL_DELIVERY: z.enum(['smtp', 'capture']).optional(),
  SMTP_HOST: z.string().trim().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_FROM: z.string().trim().min(3).default('MeuTreino+ <nao-responda@meutreino.local>'),
  APP_LINK_BASE: z.string().trim().min(1).default('meutreino://'),
  APPLE_AUDIENCES: z.string().default(''),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  GOOGLE_WEB_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URIS: z.string().default(''),
  MEDIA_ROOT: z.string().trim().min(1).default('var/media'),
  EXPORT_ROOT: z.string().trim().min(1).default('var/exports'),
  MEDIA_STORAGE: z.enum(['local']).default('local'),
  EXPECTED_DATABASE: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof envSchema> & {
  corsOrigins: string[] | false;
  accessTokenSecret: string;
  emailDelivery: 'smtp' | 'capture';
  appleAudiences: string[];
  googleClientIds: string[];
  googleRedirectUris: string[];
};

export function parseEnv(source: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }

  const data = parsed.data;
  return {
    ...data,
    corsOrigins: resolveCorsOrigins(parseCorsOrigins(data.CORS_ORIGINS)),
    accessTokenSecret: resolveAccessTokenSecret(data.NODE_ENV, data.AUTH_ACCESS_TOKEN_SECRET),
    emailDelivery: data.EMAIL_DELIVERY ?? (data.NODE_ENV === 'test' ? 'capture' : 'smtp'),
    appleAudiences: splitList(data.APPLE_AUDIENCES),
    googleClientIds: splitList(data.GOOGLE_CLIENT_IDS),
    googleRedirectUris: splitList(data.GOOGLE_REDIRECT_URIS),
  };
}

function resolveAccessTokenSecret(nodeEnv: Env['NODE_ENV'], value: string | undefined): string {
  if (value && value.length >= 32) {
    if (nodeEnv === 'production' && value === DEV_ACCESS_TOKEN_SECRET) {
      throw new Error('AUTH_ACCESS_TOKEN_SECRET must not use the development value in production.');
    }
    return value;
  }
  if (nodeEnv === 'production') {
    throw new Error('AUTH_ACCESS_TOKEN_SECRET must be at least 32 characters.');
  }
  return DEV_ACCESS_TOKEN_SECRET;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
