import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_CHANGE_TTL_SECONDS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  PRIVACY_POLICY_VERSION,
  SUPPORTED_PROFILE_LOCALE,
  TERMS_OF_USE_VERSION,
  canUnlinkIdentity,
  decideSocialAccount,
  normalizeEmail,
  type AccountView,
  type AuthProviderName,
  type DeviceInput,
  type Reauthentication,
  type SessionTokens,
} from '@meutreino/shared';
import { appLink, renderEmail, type EmailTemplate } from '../email/email';
import { EmailSender } from '../email/email';
import { PrismaService } from '../prisma/prisma.service';
import { AccountReader } from './account-reader';
import { SecurityAuditService } from './audit.service';
import { randomToken, sha256 } from './crypto';
import { HibpPasswordChecker } from './hibp';
import { fail } from './http';
import { OidcIdentityService, type VerifiedIdentity } from './oidc.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';

@Injectable()
export class AuthService {
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountReader,
    private readonly emails: EmailSender,
    private readonly audit: SecurityAuditService,
    private readonly hibp: HibpPasswordChecker,
    private readonly oidc: OidcIdentityService,
    private readonly config: ConfigService,
  ) {}

  async register(input: {
    displayName: string;
    email: string;
    password: string;
  }): Promise<{ status: 'accepted' }> {
    this.rejectPasswordEqualToEmail(input.password, input.email);
    await this.hibp.assertAcceptable(input.password);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await this.audit.record({
        userId: existing.id,
        eventType: 'register_existing_email',
        outcome: 'failure',
        subjectHash: sha256(input.email),
      });
      await this.send(input.email, 'account_exists');
      return { status: 'accepted' };
    }

    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          locale: SUPPORTED_PROFILE_LOCALE,
          profile: { create: { displayName: input.displayName } },
          authIdentities: { create: { provider: 'email', providerSubject: input.email } },
          consents: {
            create: [
              { purpose: 'terms_of_use', documentVersion: TERMS_OF_USE_VERSION, granted: true },
              { purpose: 'privacy_policy', documentVersion: PRIVACY_POLICY_VERSION, granted: true },
            ],
          },
        },
      });
      const token = await this.issueEmailToken(user.id, 'verify');
      await this.send(input.email, 'verify_email', token, 'verify-email');
      await this.audit.record({
        userId: user.id,
        eventType: 'register_accepted',
        outcome: 'success',
        subjectHash: sha256(input.email),
      });
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      await this.send(input.email, 'account_exists');
    }
    return { status: 'accepted' };
  }

  async login(input: {
    email: string;
    password: string;
    device: DeviceInput;
  }): Promise<{ tokens: SessionTokens; account: AccountView }> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const passwordMatches = await this.passwordMatches(
      user?.passwordHash,
      user?.status,
      input.password,
    );
    if (!user || user.status === 'deleted' || !passwordMatches) {
      await this.audit.record({
        userId: user && user.status !== 'deleted' ? user.id : null,
        eventType: 'login_failed',
        outcome: 'failure',
        subjectHash: sha256(input.email),
      });
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_credentials', INVALID_CREDENTIALS);
    }
    const tokens = await this.sessions.open({
      userId: user.id,
      emailVerified: user.emailVerifiedAt !== null,
      device: input.device,
    });
    await this.audit.record({ userId: user.id, eventType: 'login_succeeded', outcome: 'success' });
    return { tokens, account: await this.accounts.present(user.id) };
  }

  refresh(refreshToken: string): Promise<SessionTokens> {
    return this.sessions.rotate(refreshToken);
  }

  confirmReauthentication(userId: string, proof: Reauthentication): Promise<void> {
    return this.assertReauthenticated(userId, proof);
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.revokePresented(refreshToken);
  }

  logoutAll(userId: string): Promise<void> {
    return this.sessions.revokeAll(userId);
  }

  async verifyEmail(token: string): Promise<{ status: 'verified' }> {
    await this.consumeToken('verify', token);
    return { status: 'verified' };
  }

  async resendVerification(email: string): Promise<{ status: 'accepted' }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status !== 'deleted' && user.emailVerifiedAt === null && user.email) {
      const token = await this.issueEmailToken(user.id, 'verify');
      await this.send(user.email, 'verify_email', token, 'verify-email');
    }
    return { status: 'accepted' };
  }

  async resendForCurrentUser(userId: string): Promise<{ status: 'accepted' | 'already_verified' }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) {
      return { status: 'already_verified' };
    }
    if (user.email) {
      const token = await this.issueEmailToken(user.id, 'verify');
      await this.send(user.email, 'verify_email', token, 'verify-email');
    }
    return { status: 'accepted' };
  }

  async forgotPassword(email: string): Promise<{ status: 'accepted' }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status !== 'deleted' && user.passwordHash && user.email) {
      const token = await this.issueEmailToken(user.id, 'reset');
      await this.send(user.email, 'reset_password', token, 'reset-password');
      await this.audit.record({
        userId: user.id,
        eventType: 'password_reset_requested',
        outcome: 'success',
        subjectHash: sha256(email),
      });
    }
    return { status: 'accepted' };
  }

  async resetPassword(token: string, password: string): Promise<{ status: 'reset' }> {
    const userId = await this.consumeToken('reset', token, password);
    await this.passwordsReplaced(userId, password);
    await this.sessions.revokeAll(userId);
    return { status: 'reset' };
  }

  async signInWithApple(input: {
    identityToken: string;
    nonce: string;
    fullName?: { givenName?: string; familyName?: string } | null;
    device: DeviceInput;
    acceptTerms?: boolean;
    acceptPrivacy?: boolean;
  }): Promise<{ tokens: SessionTokens; account: AccountView }> {
    const identity = await this.oidc.verifyApple(input.identityToken, input.nonce);
    return this.completeSocialLogin(
      'apple',
      identity,
      input.device,
      input.fullName,
      input.acceptTerms,
      input.acceptPrivacy,
    );
  }

  async signInWithGoogle(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    device: DeviceInput;
    acceptTerms?: boolean;
    acceptPrivacy?: boolean;
  }): Promise<{ tokens: SessionTokens; account: AccountView }> {
    const identity = await this.oidc.exchangeGoogle(input);
    return this.completeSocialLogin(
      'google',
      identity,
      input.device,
      null,
      input.acceptTerms,
      input.acceptPrivacy,
    );
  }

  async linkIdentity(
    userId: string,
    input:
      | {
          provider: 'apple';
          identityToken: string;
          nonce: string;
          reauthentication: Reauthentication;
        }
      | {
          provider: 'google';
          code: string;
          codeVerifier: string;
          redirectUri: string;
          clientId: string;
          reauthentication: Reauthentication;
        },
  ): Promise<AccountView> {
    await this.requireVerifiedEmail(userId);
    await this.assertReauthenticated(userId, input.reauthentication);
    const identity =
      input.provider === 'apple'
        ? await this.oidc.verifyApple(input.identityToken, input.nonce)
        : await this.oidc.exchangeGoogle(input);
    const decision = await this.socialDecision(input.provider, identity, userId);
    if (decision === 'already_linked') {
      return this.accounts.present(userId);
    }
    if (decision === 'unavailable') {
      await this.audit.record({ userId, eventType: 'identity_link_conflict', outcome: 'failure' });
      throw fail(
        HttpStatus.CONFLICT,
        'identity_unavailable',
        'Esta identidade já pertence a outra conta.',
      );
    }
    await this.prisma.authIdentity.create({
      data: { userId, provider: input.provider, providerSubject: identity.sub },
    });
    await this.audit.record({ userId, eventType: 'identity_linked', outcome: 'success' });
    return this.accounts.present(userId);
  }

  async unlinkIdentity(
    userId: string,
    identityId: string,
    proof: Reauthentication,
  ): Promise<AccountView> {
    await this.assertReauthenticated(userId, proof);
    const identities = await this.prisma.authIdentity.findMany({ where: { userId } });
    const target = identities.find((identity) => identity.id === identityId);
    if (!target) {
      throw fail(HttpStatus.NOT_FOUND, 'not_found', 'Identidade não encontrada.');
    }
    if (!canUnlinkIdentity(identities.length - 1)) {
      throw fail(
        HttpStatus.CONFLICT,
        'last_identity',
        'Mantenha pelo menos um método de acesso antes de desvincular.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.authIdentity.delete({ where: { id: target.id } });
      if (target.provider === 'email') {
        await tx.user.update({ where: { id: userId }, data: { passwordHash: null } });
      }
    });
    await this.audit.record({ userId, eventType: 'identity_unlinked', outcome: 'success' });
    return this.accounts.present(userId);
  }

  async changePassword(
    userId: string,
    input: { currentPassword?: string; newPassword: string; reauthentication?: Reauthentication },
  ): Promise<void> {
    const user = await this.requireVerifiedEmail(userId);
    if (!user.email) {
      throw fail(
        HttpStatus.CONFLICT,
        'email_required',
        'Adicione um e-mail antes de definir uma senha.',
      );
    }
    this.rejectPasswordEqualToEmail(input.newPassword, user.email);
    await this.hibp.assertAcceptable(input.newPassword);
    if (user.passwordHash) {
      if (
        !input.currentPassword ||
        !(await this.passwords.verify(user.passwordHash, input.currentPassword))
      ) {
        throw fail(
          HttpStatus.UNAUTHORIZED,
          'reauthentication_failed',
          'Não foi possível confirmar sua identidade.',
        );
      }
    } else if (input.reauthentication) {
      await this.assertReauthenticated(userId, input.reauthentication);
    } else {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'reauthentication_failed',
        'Não foi possível confirmar sua identidade.',
      );
    }
    await this.passwordsReplaced(userId, input.newPassword);
  }

  async changePasswordKeepingSession(
    userId: string,
    sessionId: string,
    input: { currentPassword?: string; newPassword: string; reauthentication?: Reauthentication },
  ): Promise<void> {
    await this.changePassword(userId, input);
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null, NOT: { id: sessionId } },
      data: { revokedAt: new Date() },
    });
  }

  async requestEmailChange(
    userId: string,
    email: string,
    proof: Reauthentication,
  ): Promise<{ status: 'accepted' }> {
    const user = await this.requireVerifiedEmail(userId);
    await this.assertReauthenticated(userId, proof);
    if (user.email === email) {
      return { status: 'accepted' };
    }
    const taken = await this.prisma.user.findUnique({ where: { email } });
    if (taken) {
      throw fail(HttpStatus.CONFLICT, 'email_unavailable', 'Não foi possível usar este e-mail.');
    }
    const token = await this.issueEmailToken(userId, 'change', email);
    if (user.email) {
      await this.send(user.email, 'email_change_alert');
    }
    await this.send(email, 'email_change_confirm', token, 'confirm-email');
    return { status: 'accepted' };
  }

  async confirmEmailChange(token: string): Promise<{ status: 'confirmed' }> {
    const record = await this.findToken('change', token);
    const taken = await this.prisma.user.findUnique({
      where: { email: record.nextEmail ?? undefined },
    });
    if (taken && taken.id !== record.userId) {
      throw fail(HttpStatus.CONFLICT, 'email_unavailable', 'Não foi possível usar este e-mail.');
    }
    await this.prisma.$transaction([
      this.prisma.emailChangeToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { email: record.nextEmail, emailVerifiedAt: new Date() },
      }),
      this.prisma.authIdentity.updateMany({
        where: { userId: record.userId, provider: 'email' },
        data: { providerSubject: record.nextEmail ?? '' },
      }),
    ]);
    const emailIdentity = await this.prisma.authIdentity.findFirst({
      where: { userId: record.userId, provider: 'email' },
    });
    if (!emailIdentity && record.nextEmail) {
      await this.prisma.authIdentity.create({
        data: { userId: record.userId, provider: 'email', providerSubject: record.nextEmail },
      });
    }
    await this.sessions.revokeAll(record.userId);
    return { status: 'confirmed' };
  }

  private async completeSocialLogin(
    provider: 'apple' | 'google',
    identity: VerifiedIdentity,
    device: DeviceInput,
    fullName: { givenName?: string; familyName?: string } | null | undefined,
    acceptTerms: boolean | undefined,
    acceptPrivacy: boolean | undefined,
  ): Promise<{ tokens: SessionTokens; account: AccountView }> {
    const decision = await this.socialDecision(provider, identity, null);
    if (decision === 'link_required') {
      throw fail(
        HttpStatus.CONFLICT,
        'link_required',
        'Entre com o método original da conta e vincule este provedor nas configurações.',
      );
    }
    if (decision === 'unavailable') {
      throw fail(
        HttpStatus.CONFLICT,
        'identity_unavailable',
        'Esta identidade já pertence a outra conta.',
      );
    }
    let userId: string;
    if (decision === 'create') {
      if (acceptTerms !== true || acceptPrivacy !== true) {
        throw fail(
          HttpStatus.BAD_REQUEST,
          'consent_required',
          'Aceite os termos e a política de privacidade.',
        );
      }
      const created = await this.createSocialUser(provider, identity, fullName);
      userId = created;
    } else {
      const owner = await this.prisma.authIdentity.findUniqueOrThrow({
        where: { provider_providerSubject: { provider, providerSubject: identity.sub } },
      });
      userId = owner.userId;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === 'deleted') {
      throw fail(HttpStatus.UNAUTHORIZED, 'invalid_credentials', INVALID_CREDENTIALS);
    }
    const tokens = await this.sessions.open({
      userId,
      emailVerified: user.emailVerifiedAt !== null,
      device,
    });
    await this.audit.record({ userId, eventType: 'oauth_login', outcome: 'success' });
    return { tokens, account: await this.accounts.present(userId) };
  }

  private async createSocialUser(
    provider: 'apple' | 'google',
    identity: VerifiedIdentity,
    fullName?: { givenName?: string; familyName?: string } | null,
  ): Promise<string> {
    const email = identity.emailVerified ? identity.email : null;
    const displayName = socialDisplayName(fullName) ?? 'Aluno';
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          emailVerifiedAt: email ? new Date() : null,
          locale: SUPPORTED_PROFILE_LOCALE,
          profile: { create: { displayName } },
          authIdentities: { create: { provider, providerSubject: identity.sub } },
          consents: {
            create: [
              { purpose: 'terms_of_use', documentVersion: TERMS_OF_USE_VERSION, granted: true },
              { purpose: 'privacy_policy', documentVersion: PRIVACY_POLICY_VERSION, granted: true },
            ],
          },
        },
      });
      return user.id;
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
      throw fail(
        HttpStatus.CONFLICT,
        'link_required',
        'Entre com o método original da conta e vincule este provedor nas configurações.',
      );
    }
  }

  private async socialDecision(
    provider: AuthProviderName,
    identity: VerifiedIdentity,
    currentUserId: string | null,
  ): Promise<ReturnType<typeof decideSocialAccount>> {
    const subjectOwner = await this.prisma.authIdentity.findUnique({
      where: { provider_providerSubject: { provider, providerSubject: identity.sub } },
    });
    const emailOwner = identity.email
      ? await this.prisma.user.findUnique({ where: { email: normalizeEmail(identity.email) } })
      : null;
    return decideSocialAccount({
      subjectOwnerId: subjectOwner?.userId ?? null,
      emailOwnerId: emailOwner?.id ?? null,
      currentUserId,
    });
  }

  private async consumeToken(
    kind: 'verify' | 'reset',
    token: string,
    nextPassword?: string,
  ): Promise<string> {
    const record = await this.findToken(kind, token);
    if (kind === 'verify') {
      await this.prisma.$transaction([
        this.prisma.emailVerificationToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: new Date() },
        }),
      ]);
      await this.audit.record({
        userId: record.userId,
        eventType: 'email_verified',
        outcome: 'success',
      });
      return record.userId;
    }
    if (!nextPassword) {
      throw new Error('Password is required to consume a reset token.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    if (user.email) {
      this.rejectPasswordEqualToEmail(nextPassword, user.email);
    }
    await this.hibp.assertAcceptable(nextPassword);
    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await this.audit.record({
      userId: record.userId,
      eventType: 'password_reset_completed',
      outcome: 'success',
    });
    return record.userId;
  }

  private async findToken(
    kind: 'verify' | 'reset' | 'change',
    token: string,
  ): Promise<{ id: string; userId: string; nextEmail?: string | null }> {
    const tokenHash = sha256(token);
    const record =
      kind === 'verify'
        ? await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } })
        : kind === 'reset'
          ? await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } })
          : await this.prisma.emailChangeToken.findUnique({ where: { tokenHash } });
    if (!record) {
      throw fail(HttpStatus.BAD_REQUEST, 'token_invalid', 'O link é inválido.');
    }
    if (record.usedAt) {
      throw fail(HttpStatus.BAD_REQUEST, 'token_reused', 'Este link já foi usado.');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw fail(HttpStatus.BAD_REQUEST, 'token_expired', 'Este link expirou.');
    }
    return {
      id: record.id,
      userId: record.userId,
      nextEmail: readNextEmail(record),
    };
  }

  private async issueEmailToken(
    userId: string,
    kind: 'verify' | 'reset' | 'change',
    nextEmail?: string,
  ): Promise<string> {
    const token = randomToken();
    const tokenHash = sha256(token);
    const now = new Date();
    const ttl =
      kind === 'reset'
        ? PASSWORD_RESET_TTL_SECONDS
        : kind === 'change'
          ? EMAIL_CHANGE_TTL_SECONDS
          : EMAIL_VERIFICATION_TTL_SECONDS;
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    if (kind === 'verify') {
      await this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      await this.prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
    } else if (kind === 'reset') {
      await this.prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      await this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
    } else if (nextEmail) {
      await this.prisma.emailChangeToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      await this.prisma.emailChangeToken.create({
        data: { userId, nextEmail, tokenHash, expiresAt },
      });
    }
    return token;
  }

  private async passwordsReplaced(userId: string, password: string): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    if (user.email) {
      await this.prisma.authIdentity.upsert({
        where: { provider_providerSubject: { provider: 'email', providerSubject: user.email } },
        create: { userId, provider: 'email', providerSubject: user.email },
        update: {},
      });
      await this.send(user.email, 'password_changed');
    }
    await this.audit.record({ userId, eventType: 'password_changed', outcome: 'success' });
  }

  private async assertReauthenticated(userId: string, proof: Reauthentication): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { authIdentities: true },
    });
    if (!user || user.status === 'deleted') {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'reauthentication_failed',
        'Não foi possível confirmar sua identidade.',
      );
    }
    if (proof.method === 'password') {
      if (!user.passwordHash || !(await this.passwords.verify(user.passwordHash, proof.password))) {
        throw fail(
          HttpStatus.UNAUTHORIZED,
          'reauthentication_failed',
          'Não foi possível confirmar sua identidade.',
        );
      }
      return;
    }
    const identity =
      proof.method === 'apple'
        ? await this.oidc.verifyApple(proof.identityToken, proof.nonce)
        : await this.oidc.exchangeGoogle(proof);
    const linked = user.authIdentities.some(
      (item) => item.provider === proof.method && item.providerSubject === identity.sub,
    );
    if (!linked) {
      throw fail(
        HttpStatus.UNAUTHORIZED,
        'reauthentication_failed',
        'Não foi possível confirmar sua identidade.',
      );
    }
  }

  private async requireVerifiedEmail(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'deleted') {
      throw fail(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Autenticação necessária.');
    }
    if (!user.emailVerifiedAt) {
      throw fail(
        HttpStatus.FORBIDDEN,
        'email_not_verified',
        'Confirme seu e-mail antes de continuar.',
      );
    }
    return user;
  }

  private async passwordMatches(
    passwordHash: string | null | undefined,
    status: string | undefined,
    password: string,
  ): Promise<boolean> {
    if (!passwordHash || status === 'deleted') {
      this.dummyHash ??= await this.passwords.hash('not-a-user-password');
      await this.passwords.verify(this.dummyHash, password);
      return false;
    }
    return this.passwords.verify(passwordHash, password);
  }

  private rejectPasswordEqualToEmail(password: string, email: string): void {
    if (password.toLowerCase() === email.toLowerCase()) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'password_rejected',
        'A senha não pode ser igual ao e-mail.',
      );
    }
  }

  async notifyDeletion(email: string | null): Promise<void> {
    if (!email) {
      return;
    }
    try {
      await this.send(email, 'account_deletion');
    } catch {
      await this.audit.record({ eventType: 'account_deletion_email_failed', outcome: 'failure' });
    }
  }

  private async send(
    to: string,
    template: EmailTemplate,
    token?: string,
    path?: string,
  ): Promise<void> {
    const base = this.config.get<string>('APP_LINK_BASE') ?? 'meutreino://';
    const link = token && path ? appLink(base, path, token) : undefined;
    await this.emails.send(renderEmail({ template, to, link }));
  }
}

function socialDisplayName(
  fullName?: { givenName?: string; familyName?: string } | null,
): string | null {
  const name = [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ').trim();
  if (!name) {
    return null;
  }
  return name.slice(0, 80);
}

function readNextEmail(record: object): string | null {
  if ('nextEmail' in record && typeof record.nextEmail === 'string') {
    return record.nextEmail;
  }
  return null;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
