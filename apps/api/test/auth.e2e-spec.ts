import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DELETE_ACCOUNT_CONFIRMATION } from '@meutreino/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { EmailOutbox, tokenFromMessage } from '../src/email/email';
import { OidcIdentityService, type VerifiedIdentity } from '../src/identity/oidc.service';
import { DeletionService } from '../src/identity/deletion.service';
import { PrismaService } from '../src/prisma/prisma.service';

type Tokens = { accessToken: string; refreshToken: string };

function device(label = 'iPhone') {
  return {
    installationId: randomUUID(),
    platform: 'ios' as const,
    appVersion: '0.1.0',
    label,
  };
}

function errorCode(body: unknown): string {
  return (body as { error: { code: string; message: string } }).error.code;
}

jest.setTimeout(120_000);

describe('Identity API', () => {
  let app: NestExpressApplication;
  let outbox: EmailOutbox;
  let prisma: PrismaService;
  let deletion: DeletionService;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OidcIdentityService)
      .useValue({
        verifyApple: (identityToken: string) =>
          Promise.resolve(JSON.parse(identityToken) as VerifiedIdentity),
        exchangeGoogle: (input: { code: string }) =>
          Promise.resolve(JSON.parse(input.code) as VerifiedIdentity),
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    outbox = app.get(EmailOutbox);
    prisma = app.get(PrismaService);
    deletion = app.get(DeletionService);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await deletion.purge(userId).catch(() => undefined);
    }
    await app.close();
  });

  it('registers, verifies, signs in without a subscription, and isolates accounts', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await request(server())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Ana', email, password, acceptTerms: true, acceptPrivacy: true })
      .expect(202);
    await request(server())
      .post('/api/v1/auth/register')
      .send({
        displayName: 'Ana',
        email: email.toUpperCase(),
        password,
        acceptTerms: true,
        acceptPrivacy: true,
      })
      .expect(202);

    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(outbox.latest(email, 'account_exists')).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).not.toContain(password);

    const unverified = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(200);
    await request(server())
      .post('/api/v1/me/identities/link')
      .set(bearer(unverified.body.tokens.accessToken as string))
      .send({
        provider: 'apple',
        identityToken: JSON.stringify({ sub: 'apple-early', email, emailVerified: true }),
        nonce: 'nonce-value-123456',
        reauthentication: { method: 'password', password },
      })
      .expect(403);

    const token = tokenFromMessage(outbox.latest(email, 'verify_email')!);
    await request(server()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
    await request(server())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400)
      .expect((response) => {
        expect(errorCode(response.body)).toBe('token_reused');
      });

    const unknown = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail(), password, device: device() })
      .expect(401);
    const wrong = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: 'not-the-right-password', device: device() })
      .expect(401);
    expect(errorCode(unknown.body)).toBe(errorCode(wrong.body));
    expect((unknown.body as { error: { message: string } }).error.message).toBe(
      (wrong.body as { error: { message: string } }).error.message,
    );

    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device('Ana iPhone') })
      .expect(200);
    const tokens = login.body.tokens as Tokens;
    expect(login.body.account.entitlement.active).toBe(false);
    expect(login.body.account.accountManagement.allowed).toBe(true);
    expect(login.body.account.emailVerified).toBe(true);

    await request(server()).get('/api/v1/me').expect(401);
    const me = await request(server())
      .get('/api/v1/me')
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(me.body.profile.displayName).toBe('Ana');

    const updated = await request(server())
      .patch('/api/v1/me')
      .set(bearer(tokens.accessToken))
      .send({
        displayName: 'Ana Lima',
        weightUnit: 'lb',
        distanceUnit: 'mi',
        theme: 'dark',
        timeZone: 'America/Manaus',
        notifyProductEmail: true,
      })
      .expect(200);
    expect(updated.body.profile).toMatchObject({
      displayName: 'Ana Lima',
      weightUnit: 'lb',
      distanceUnit: 'mi',
      theme: 'dark',
      timeZone: 'America/Manaus',
      notifyProductEmail: true,
    });
    const stored = await prisma.userProfile.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.displayName).toBe('Ana Lima');

    const otherEmail = uniqueEmail();
    await registerVerified(otherEmail, password);
    const other = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: otherEmail, password, device: device() })
      .expect(200);
    const exportResponse = await request(server())
      .post('/api/v1/me/export')
      .set(bearer(tokens.accessToken))
      .expect(201);
    await request(server())
      .get(`/api/v1/me/export/${exportResponse.body.id as string}`)
      .set(bearer(other.body.tokens.accessToken as string))
      .expect(404);
    const download = await request(server())
      .get(`/api/v1/me/export/${exportResponse.body.id as string}/download`)
      .set(bearer(tokens.accessToken))
      .expect(200);
    expect(download.text).toContain('Ana Lima');
    expect(download.text).not.toContain('passwordHash');
    expect(download.text).not.toContain(tokens.refreshToken);

    const rotated = await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401)
      .expect((response) => expect(errorCode(response.body)).toBe('refresh_token_reused'));
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken as string })
      .expect(401);
  });

  it('rejects an expired verification token', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await request(server())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Bia', email, password, acceptTerms: true, acceptPrivacy: true })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    const token = tokenFromMessage(outbox.latest(email, 'verify_email')!);
    await prisma.emailVerificationToken.update({
      where: {
        tokenHash: (await import('node:crypto')).createHash('sha256').update(token).digest('hex'),
      },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await request(server())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400)
      .expect((response) => expect(errorCode(response.body)).toBe('token_expired'));
  });

  it('resets a password, revokes sessions, and answers unknown addresses the same way', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    const nextPassword = 'another-correct-horse';
    await registerVerified(email, password);
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(200);
    const unknown = await request(server())
      .post('/api/v1/auth/forgot-password')
      .send({ email: uniqueEmail() })
      .expect(202);
    const known = await request(server())
      .post('/api/v1/auth/forgot-password')
      .send({ email })
      .expect(202);
    expect(known.body).toEqual(unknown.body);
    const token = tokenFromMessage(outbox.latest(email, 'reset_password')!);
    await request(server())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: nextPassword })
      .expect(200);
    expect(outbox.latest(email, 'password_changed')).toBeTruthy();
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken as string })
      .expect(401);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password: nextPassword, device: device() })
      .expect(200);
    await request(server())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: nextPassword })
      .expect(400);
  });

  it('logs out one device and every device', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await registerVerified(email, password);
    const first = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device('one') })
      .expect(200);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device('two') })
      .expect(200);
    const sessions = await request(server())
      .get('/api/v1/me/sessions')
      .set(bearer(first.body.tokens.accessToken as string))
      .expect(200);
    const otherSession = (sessions.body.sessions as Array<{ id: string; current: boolean }>).find(
      (session) => !session.current,
    );
    expect(otherSession).toBeTruthy();
    const strangerEmail = uniqueEmail();
    await registerVerified(strangerEmail, password);
    const stranger = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: strangerEmail, password, device: device() })
      .expect(200);
    await request(server())
      .delete(`/api/v1/me/sessions/${otherSession!.id}`)
      .set(bearer(stranger.body.tokens.accessToken as string))
      .expect(404);
    await request(server())
      .delete(`/api/v1/me/sessions/${otherSession!.id}`)
      .set(bearer(first.body.tokens.accessToken as string))
      .expect(204);
    await request(server())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: first.body.tokens.refreshToken })
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.tokens.refreshToken })
      .expect(401);

    const third = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device('three') })
      .expect(200);
    const fourth = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device('four') })
      .expect(200);
    await request(server())
      .post('/api/v1/me/logout-all')
      .set(bearer(third.body.tokens.accessToken as string))
      .expect(204);
    await request(server())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: fourth.body.tokens.refreshToken })
      .expect(401);
  });

  it('links a provider only after reauthentication and refuses takeover', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await registerVerified(email, password);
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(200);
    const apple = { sub: `apple-${randomUUID()}`, email, emailVerified: true };
    await request(server())
      .post('/api/v1/auth/apple')
      .send({
        identityToken: JSON.stringify(apple),
        nonce: 'nonce-value-123456',
        device: device(),
        acceptTerms: true,
        acceptPrivacy: true,
      })
      .expect(409)
      .expect((response) => expect(errorCode(response.body)).toBe('link_required'));
    expect(
      await prisma.authIdentity.count({ where: { provider: 'apple', providerSubject: apple.sub } }),
    ).toBe(0);

    const linked = await request(server())
      .post('/api/v1/me/identities/link')
      .set(bearer(login.body.tokens.accessToken as string))
      .send({
        provider: 'apple',
        identityToken: JSON.stringify(apple),
        nonce: 'nonce-value-123456',
        reauthentication: { method: 'password', password: 'wrong-password-here' },
      })
      .expect(401);
    expect(errorCode(linked.body)).toBe('reauthentication_failed');

    await request(server())
      .post('/api/v1/me/identities/link')
      .set(bearer(login.body.tokens.accessToken as string))
      .send({
        provider: 'apple',
        identityToken: JSON.stringify(apple),
        nonce: 'nonce-value-123456',
        reauthentication: { method: 'password', password },
      })
      .expect(201);
    const appleLogin = await request(server())
      .post('/api/v1/auth/apple')
      .send({
        identityToken: JSON.stringify(apple),
        nonce: 'nonce-value-123456',
        device: device(),
      })
      .expect(200);
    expect(appleLogin.body.account.email).toBe(email);

    const otherEmail = uniqueEmail();
    await registerVerified(otherEmail, password);
    const other = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: otherEmail, password, device: device() })
      .expect(200);
    await request(server())
      .post('/api/v1/me/identities/link')
      .set(bearer(other.body.tokens.accessToken as string))
      .send({
        provider: 'apple',
        identityToken: JSON.stringify(apple),
        nonce: 'nonce-value-123456',
        reauthentication: { method: 'password', password },
      })
      .expect(409);

    const google = { sub: `google-${randomUUID()}`, email: null, emailVerified: false };
    await request(server())
      .post('/api/v1/auth/google')
      .send({
        code: JSON.stringify(google),
        codeVerifier: 'a'.repeat(43),
        redirectUri: 'meutreino://oauth',
        clientId: 'test-client',
        device: device(),
      })
      .expect(400);
    const created = await request(server())
      .post('/api/v1/auth/google')
      .send({
        code: JSON.stringify(google),
        codeVerifier: 'a'.repeat(43),
        redirectUri: 'meutreino://oauth',
        clientId: 'test-client',
        device: device(),
        acceptTerms: true,
        acceptPrivacy: true,
      })
      .expect(200);
    createdUserIds.push(created.body.account.id as string);
    const identityId = (created.body.account.identities as Array<{ id: string }>)[0]?.id;
    await request(server())
      .delete(`/api/v1/me/identities/${identityId}`)
      .set(bearer(created.body.tokens.accessToken as string))
      .send({
        reauthentication: {
          method: 'google',
          code: JSON.stringify(google),
          codeVerifier: 'a'.repeat(43),
          redirectUri: 'meutreino://oauth',
          clientId: 'test-client',
        },
      })
      .expect(409);
  });

  it('deletes the account and keeps account routes independent of subscription', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await registerVerified(email, password);
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(200);
    await request(server())
      .post('/api/v1/me/delete-account')
      .set(bearer(login.body.tokens.accessToken as string))
      .send({ confirmation: 'apagar', reauthentication: { method: 'password', password } })
      .expect(400);
    await request(server())
      .post('/api/v1/me/delete-account')
      .set(bearer(login.body.tokens.accessToken as string))
      .send({
        confirmation: DELETE_ACCOUNT_CONFIRMATION,
        reauthentication: { method: 'password', password },
      })
      .expect(200);
    expect(outbox.latest(email, 'account_deletion')).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: login.body.account.id as string },
    });
    expect(user.email).toBeNull();
    expect(user.status).toBe('deleted');
    expect(user.passwordHash).toBeNull();
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(401);
    await request(server())
      .get('/api/v1/me')
      .set(bearer(login.body.tokens.accessToken as string))
      .expect(401);
  });

  it('rate limits repeated login attempts for the same account', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';
    await registerVerified(email, password);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await request(server())
        .post('/api/v1/auth/login')
        .send({ email, password: `wrong-password-${attempt}-xx`, device: device() })
        .expect(401);
    }
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password, device: device() })
      .expect(429);
  });

  async function registerVerified(email: string, password: string): Promise<void> {
    await request(server())
      .post('/api/v1/auth/register')
      .send({ displayName: 'Aluno', email, password, acceptTerms: true, acceptPrivacy: true })
      .expect(202);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    const token = tokenFromMessage(outbox.latest(email, 'verify_email')!);
    await request(server()).post('/api/v1/auth/verify-email').send({ token }).expect(200);
  }

  function server(): App {
    return app.getHttpServer() as App;
  }
});

function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function uniqueEmail(): string {
  return `prompt01-${randomUUID()}@example.com`;
}
