import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const REFRESH_IDLE_TTL_SECONDS = 14 * 24 * 60 * 60;
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;
export const EMAIL_CHANGE_TTL_SECONDS = 24 * 60 * 60;
export const EXPORT_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DELETE_ACCOUNT_CONFIRMATION = 'EXCLUIR MINHA CONTA';
export const TERMS_OF_USE_VERSION = '2026-10-20';
export const PRIVACY_POLICY_VERSION = '2026-10-20';
export const SUPPORTED_PROFILE_LOCALE = 'pt-BR';
export const SECURE_REFRESH_TOKEN_KEY = 'meutreino.refresh_token';
export const SECURE_INSTALLATION_ID_KEY = 'meutreino.installation_id';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isTimeZone(value: string): boolean {
  if (value.trim() !== value || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    Intl.DateTimeFormat('pt-BR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const emailSchema = z
  .string()
  .trim()
  .max(254, 'Use no máximo 254 caracteres.')
  .email('Informe um e-mail válido.')
  .transform(normalizeEmail);

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `Use no máximo ${PASSWORD_MAX_LENGTH} caracteres.`);

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe seu nome.')
  .max(80, 'Use no máximo 80 caracteres.');

export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export const DISTANCE_UNITS = ['km', 'mi'] as const;
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const AUTH_PROVIDERS = ['email', 'apple', 'google'] as const;
export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;

export const deviceSchema = z.object({
  installationId: z.uuid(),
  platform: z.enum(DEVICE_PLATFORMS),
  appVersion: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80).optional(),
});

export const registerSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: 'Aceite os Termos de Uso.' }),
  acceptPrivacy: z.literal(true, { error: 'Confirme a ciência da Política de Privacidade.' }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  device: deviceSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(20).max(500),
});

export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(20).max(500),
});

export const tokenSchema = z.object({
  token: z.string().trim().min(20).max(500),
});

export const emailRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(500),
  password: passwordSchema,
});

export const appleAuthSchema = z.object({
  identityToken: z.string().trim().min(20).max(8000),
  nonce: z.string().trim().min(8).max(256),
  fullName: z
    .object({
      givenName: z.string().trim().max(40).optional(),
      familyName: z.string().trim().max(40).optional(),
    })
    .nullable()
    .optional(),
  acceptTerms: z.literal(true).optional(),
  acceptPrivacy: z.literal(true).optional(),
  device: deviceSchema,
});

export const googleAuthSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  codeVerifier: z.string().trim().min(43).max(128),
  redirectUri: z.string().trim().url().max(300),
  clientId: z.string().trim().min(1).max(256),
  acceptTerms: z.literal(true).optional(),
  acceptPrivacy: z.literal(true).optional(),
  device: deviceSchema,
});

export const reauthenticationSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('password'),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  }),
  z.object({
    method: z.literal('apple'),
    identityToken: z.string().trim().min(20).max(8000),
    nonce: z.string().trim().min(8).max(256),
  }),
  z.object({
    method: z.literal('google'),
    code: z.string().trim().min(1).max(2048),
    codeVerifier: z.string().trim().min(43).max(128),
    redirectUri: z.string().trim().url().max(300),
    clientId: z.string().trim().min(1).max(256),
  }),
]);

export const linkIdentitySchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('apple'),
    identityToken: z.string().trim().min(20).max(8000),
    nonce: z.string().trim().min(8).max(256),
    reauthentication: reauthenticationSchema,
  }),
  z.object({
    provider: z.literal('google'),
    code: z.string().trim().min(1).max(2048),
    codeVerifier: z.string().trim().min(43).max(128),
    redirectUri: z.string().trim().url().max(300),
    clientId: z.string().trim().min(1).max(256),
    reauthentication: reauthenticationSchema,
  }),
]);

export const unlinkIdentitySchema = z.object({
  reauthentication: reauthenticationSchema,
});

export const profileUpdateSchema = z.object({
  displayName: displayNameSchema,
  weightUnit: z.enum(WEIGHT_UNITS),
  distanceUnit: z.enum(DISTANCE_UNITS),
  theme: z.enum(THEME_PREFERENCES),
  timeZone: z.string().trim().max(64).refine(isTimeZone, 'Informe um fuso horário válido.'),
  notifyProductEmail: z.boolean(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
  newPassword: passwordSchema,
  reauthentication: reauthenticationSchema.optional(),
});

export const emailChangeSchema = z.object({
  email: emailSchema,
  reauthentication: reauthenticationSchema,
});

export const profilePhotoSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().trim().min(1).max(7_000_000),
});

export const deleteAccountSchema = z.object({
  confirmation: z.literal(DELETE_ACCOUNT_CONFIRMATION, {
    error: 'Digite a confirmação exatamente como solicitado.',
  }),
  reauthentication: reauthenticationSchema,
});

export const sessionTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshTokenExpiresAt: z.iso.datetime(),
});

export const entitlementViewSchema = z.object({
  feature: z.literal('app_access'),
  active: z.boolean(),
  activeUntil: z.string().nullable(),
  sourceSubscriptionId: z.string().nullable(),
  source: z.enum(['store_subscription', 'none']),
});

export const accountSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  status: z.enum(['active', 'pending_deletion', 'deleted']),
  profile: z.object({
    displayName: z.string(),
    locale: z.literal(SUPPORTED_PROFILE_LOCALE),
    weightUnit: z.enum(WEIGHT_UNITS),
    distanceUnit: z.enum(DISTANCE_UNITS),
    theme: z.enum(THEME_PREFERENCES),
    timeZone: z.string(),
    notifyProductEmail: z.boolean(),
    hasPhoto: z.boolean(),
  }),
  identities: z.array(
    z.object({
      id: z.uuid(),
      provider: z.enum(AUTH_PROVIDERS),
      createdAt: z.iso.datetime(),
    }),
  ),
  entitlement: entitlementViewSchema,
  accountManagement: z.object({
    allowed: z.boolean(),
  }),
});

export const loginResponseSchema = z.object({
  tokens: sessionTokensSchema,
  account: accountSchema,
});

export const acceptedResponseSchema = z.object({
  status: z.literal('accepted'),
});

export const sessionListSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.uuid(),
      current: z.boolean(),
      createdAt: z.iso.datetime(),
      lastUsedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      deviceLabel: z.string().nullable(),
      platform: z.enum(DEVICE_PLATFORMS).nullable(),
    }),
  ),
});

export const exportStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['pending', 'processing', 'ready', 'failed', 'expired']),
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DeviceInput = z.infer<typeof deviceSchema>;
export type AccountView = z.infer<typeof accountSchema>;
export type SessionTokens = z.infer<typeof sessionTokensSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
export type Reauthentication = z.infer<typeof reauthenticationSchema>;
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number];

export function localDatabaseName(userId: string): string {
  if (!USER_ID.test(userId)) {
    throw new Error('userId must be a UUID.');
  }
  return `meutreino-${userId.toLowerCase()}.db`;
}

export function logoutLocalTargets(userId: string): {
  databaseName: string;
  secureKeys: readonly string[];
} {
  return {
    databaseName: localDatabaseName(userId),
    secureKeys: [SECURE_REFRESH_TOKEN_KEY],
  };
}

export type RefreshClassification = 'rotate' | 'reuse' | 'expired' | 'unknown';

export function classifyRefresh(input: {
  session: {
    revokedAt: string | null;
    replacedById: string | null;
    expiresAt: string;
    lastUsedAt: string;
  } | null;
  now: Date;
  idleMs: number;
}): RefreshClassification {
  if (!input.session) {
    return 'unknown';
  }
  if (input.session.revokedAt !== null || input.session.replacedById !== null) {
    return 'reuse';
  }
  const now = input.now.getTime();
  const expiresAt = Date.parse(input.session.expiresAt);
  const lastUsedAt = Date.parse(input.session.lastUsedAt);
  if (expiresAt <= now || now - lastUsedAt > input.idleMs) {
    return 'expired';
  }
  return 'rotate';
}

export type SocialAccountDecision =
  'sign_in' | 'create' | 'link' | 'link_required' | 'already_linked' | 'unavailable';

export function decideSocialAccount(input: {
  subjectOwnerId: string | null;
  emailOwnerId: string | null;
  currentUserId: string | null;
}): SocialAccountDecision {
  if (input.currentUserId) {
    if (input.subjectOwnerId === input.currentUserId) {
      return 'already_linked';
    }
    if (input.subjectOwnerId) {
      return 'unavailable';
    }
    return 'link';
  }

  if (input.subjectOwnerId) {
    return 'sign_in';
  }
  if (input.emailOwnerId) {
    return 'link_required';
  }
  return 'create';
}

export function canUnlinkIdentity(remainingIdentityCount: number): boolean {
  return remainingIdentityCount >= 1;
}
