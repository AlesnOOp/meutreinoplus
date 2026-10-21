import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailOutbox, EmailSender } from './email';
import { CaptureEmailSender, SmtpEmailSender } from './email-sender';

@Module({
  providers: [
    EmailOutbox,
    {
      provide: EmailSender,
      inject: [ConfigService, EmailOutbox],
      useFactory: (config: ConfigService, outbox: EmailOutbox): EmailSender => {
        const nodeEnv = config.get<string>('NODE_ENV');
        const delivery = config.get<string>('emailDelivery');
        if (delivery === 'capture' || nodeEnv === 'test') {
          return new CaptureEmailSender(outbox);
        }
        return new SmtpEmailSender(
          config.get<string>('SMTP_HOST') ?? '127.0.0.1',
          Number(config.get('SMTP_PORT') ?? 1025),
          config.get<string>('SMTP_FROM') ?? 'MeuTreino+ <nao-responda@meutreino.local>',
        );
      },
    },
  ],
  exports: [EmailSender, EmailOutbox],
})
export class EmailModule {}
