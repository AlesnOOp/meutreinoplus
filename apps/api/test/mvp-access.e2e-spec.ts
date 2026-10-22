import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { EmailSender } from '../src/email/email';
import { SmtpEmailSender } from '../src/email/email-sender';
import { DeletionService } from '../src/identity/deletion.service';

// Real SMTP wire protocol in an isolated local receiver. No SQL/outbox token lookup.
describe('MVP first access over HTTP and SMTP', () => {
  let app: NestExpressApplication;
  let smtp: Server;
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  let userId: string | undefined;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (
      process.env.NODE_ENV !== 'test' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '55439' ||
      url.pathname !== '/mt_recovery01_test_verified' ||
      process.env.EXPECTED_DATABASE !== url.pathname.slice(1)
    ) {
      throw new Error('Requires the verified disposable PostgreSQL.');
    }
    smtp = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.setEncoding('utf8');
      socket.write('220 localhost MVP test SMTP\r\n');
      let buffer = '',
        data = false;
      let body: string[] = [];
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        while (buffer.includes('\r\n')) {
          const index = buffer.indexOf('\r\n'),
            line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (data) {
            if (line === '.') {
              messages.push(body.join('\r\n'));
              body = [];
              data = false;
              socket.write('250 queued\r\n');
            } else body.push(line.startsWith('..') ? line.slice(1) : line);
          } else if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
          else if (line === 'DATA') {
            data = true;
            socket.write('354 End with dot\r\n');
          } else if (line === 'QUIT') {
            socket.end('221 bye\r\n');
          } else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    const address = smtp.address();
    if (!address || typeof address === 'string') throw new Error('SMTP address unavailable');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue(new SmtpEmailSender('127.0.0.1', address.port, 'demo@meutreino.local'))
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    if (userId) await app.get(DeletionService).purge(userId);
    if (app) await app.close();
    for (const socket of sockets) socket.destroy();
    if (smtp) await new Promise<void>((resolve) => smtp.close(() => resolve()));
  });
  it('receives the confirmation through SMTP, confirms, logs in, rotates and revokes', async () => {
    const http = () => request(app.getHttpServer() as App);
    const email = `mvp-${randomUUID()}@example.com`,
      password = 'correct-horse-battery';
    await http()
      .post('/api/v1/auth/register')
      .send({ displayName: 'MVP Demo', email, password, acceptTerms: true, acceptPrivacy: true })
      .expect(202);
    expect(messages).toHaveLength(1);
    // Unfold quoted-printable transport wrapping before reading the delivered link.
    const delivered = messages[0].replace(/=\r\n/g, '').replace(/=3D/g, '=');
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(delivered)?.[1];
    expect(token).toBeTruthy();
    await http().post('/api/v1/auth/verify-email').send({ token }).expect(200);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({
        email,
        password,
        device: {
          installationId: randomUUID(),
          platform: 'ios',
          appVersion: '0.1.0',
          label: 'MVP',
        },
      })
      .expect(200);
    userId = login.body.account.id as string;
    expect(login.body.account.emailVerified).toBe(true);
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(200);
    const me = await http()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
      .expect(200);
    expect(me.body.id).toBe(userId);
    await http()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });
});
