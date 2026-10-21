import { Injectable } from '@nestjs/common';
import type { SecurityAuditOutcome } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SecurityAuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: {
    userId?: string | null;
    eventType: string;
    outcome: SecurityAuditOutcome;
    subjectHash?: string | null;
  }): Promise<void> {
    return this.prisma.securityAuditEvent
      .create({
        data: {
          userId: input.userId ?? null,
          eventType: input.eventType,
          outcome: input.outcome,
          subjectHash: input.subjectHash ?? null,
        },
      })
      .then(() => undefined);
  }
}
