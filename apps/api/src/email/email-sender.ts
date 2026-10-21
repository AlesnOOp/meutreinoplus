import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { sha256 } from '../identity/crypto';
import { EmailOutbox, EmailSender, type OutboundEmail } from './email';

@Injectable()
export class CaptureEmailSender extends EmailSender {
  constructor(private readonly outbox: EmailOutbox) {
    super();
  }

  send(message: OutboundEmail): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }
}

@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly logger = new Logger(SmtpEmailSender.name);

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly from: string,
  ) {
    super();
  }

  async send(message: OutboundEmail): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: false,
    });
    await transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    this.logger.log({
      template: message.template,
      recipientHash: sha256(message.to),
    });
  }
}
