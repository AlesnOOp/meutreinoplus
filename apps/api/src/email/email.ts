import { Injectable } from '@nestjs/common';

export type EmailTemplate =
  | 'verify_email'
  | 'account_exists'
  | 'reset_password'
  | 'password_changed'
  | 'email_change_alert'
  | 'email_change_confirm'
  | 'account_deletion';

export type OutboundEmail = {
  to: string;
  template: EmailTemplate;
  subject: string;
  text: string;
  html: string;
};

export abstract class EmailSender {
  abstract send(message: OutboundEmail): Promise<void>;
}

@Injectable()
export class EmailOutbox {
  readonly messages: OutboundEmail[] = [];

  push(message: OutboundEmail): void {
    this.messages.push(message);
  }

  latest(to: string, template: EmailTemplate): OutboundEmail | undefined {
    return [...this.messages]
      .reverse()
      .find((message) => message.to === to && message.template === template);
  }
}

export function tokenFromMessage(message: OutboundEmail): string {
  const match = /[?&]token=([^&\s]+)/.exec(message.text);
  if (!match?.[1]) {
    throw new Error(`Message ${message.template} does not contain a token.`);
  }
  return decodeURIComponent(match[1]);
}

export function appLink(base: string, path: string, token: string): string {
  const normalized = base.endsWith('://') ? base : `${base.replace(/\/$/, '')}/`;
  return `${normalized}${path}?token=${encodeURIComponent(token)}`;
}

export function renderEmail(input: {
  template: EmailTemplate;
  to: string;
  link?: string;
  previousEmail?: string;
}): OutboundEmail {
  const link = input.link ?? '';
  const content: Record<EmailTemplate, { subject: string; text: string }> = {
    verify_email: {
      subject: 'Confirme seu e-mail no MeuTreino+',
      text: `Confirme seu e-mail para concluir o cadastro. O link expira em 24 horas.\n\n${link}\n\nSe você não criou esta conta, ignore esta mensagem.`,
    },
    account_exists: {
      subject: 'Tentativa de cadastro no MeuTreino+',
      text: 'Alguém tentou criar uma conta com este e-mail. Se foi você, entre com sua senha ou recupere o acesso. Se não foi, nenhuma alteração foi feita.',
    },
    reset_password: {
      subject: 'Recuperação de senha do MeuTreino+',
      text: `Use o link abaixo para definir uma nova senha. Ele expira em 30 minutos e só pode ser usado uma vez.\n\n${link}\n\nSe você não pediu a recuperação, ignore esta mensagem.`,
    },
    password_changed: {
      subject: 'Sua senha do MeuTreino+ foi alterada',
      text: 'A senha da sua conta foi alterada e as outras sessões foram encerradas. Se você não fez essa alteração, recupere o acesso imediatamente.',
    },
    email_change_alert: {
      subject: 'Pedido de alteração de e-mail no MeuTreino+',
      text: 'Recebemos um pedido para alterar o e-mail desta conta. O endereço só muda depois da confirmação no novo e-mail. Se você não pediu isso, altere sua senha.',
    },
    email_change_confirm: {
      subject: 'Confirme seu novo e-mail no MeuTreino+',
      text: `Confirme o novo endereço da sua conta. O link expira em 24 horas.\n\n${link}`,
    },
    account_deletion: {
      subject: 'Sua conta do MeuTreino+ foi excluída',
      text: 'A exclusão da conta foi concluída. Sessões foram encerradas e os dados pessoais desta conta foram removidos, com as exceções de retenção descritas na política de privacidade.',
    },
  };
  const selected = content[input.template];
  return {
    to: input.to,
    template: input.template,
    subject: selected.subject,
    text: selected.text,
    html: `<p>${selected.text.replaceAll('\n', '<br>')}</p>`,
  };
}
