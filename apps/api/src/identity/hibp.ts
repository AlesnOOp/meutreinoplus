import { Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { fail } from './http';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';

@Injectable()
export class HibpPasswordChecker {
  private readonly logger = new Logger(HibpPasswordChecker.name);

  constructor(private readonly mode: 'development' | 'test' | 'production' = 'production') {}

  async assertAcceptable(password: string): Promise<void> {
    if (this.mode === 'test') {
      return;
    }
    const compromised = await this.isCompromised(password);
    if (compromised === null) {
      this.logger.warn('Password breach check unavailable. Registration continued.');
      return;
    }
    if (compromised) {
      throw fail(
        HttpStatus.BAD_REQUEST,
        'password_compromised',
        'Escolha outra senha. Esta aparece em vazamentos públicos conhecidos.',
      );
    }
  }

  async isCompromised(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean | null> {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        return null;
      }
      const body = await response.text();
      return rangeContains(body, suffix);
    } catch {
      return null;
    }
  }
}

export function rangeContains(body: string, suffix: string): boolean {
  return body.split('\n').some((line) => {
    const [candidate, count] = line.trim().split(':');
    return candidate?.toUpperCase() === suffix && Number(count) > 0;
  });
}
