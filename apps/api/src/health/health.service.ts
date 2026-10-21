import { Injectable } from '@nestjs/common';
import { healthReportSchema, type HealthReport } from '@meutreino/shared';
import { API_SERVICE_NAME, API_VERSION } from '../version';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly database: PrismaService) {}

  async getReport(now = new Date()): Promise<HealthReport> {
    const databaseUp = await this.database.ping();
    return healthReportSchema.parse({
      status: databaseUp ? 'ok' : 'degraded',
      service: API_SERVICE_NAME,
      version: API_VERSION,
      timestamp: now.toISOString(),
      checks: {
        database: databaseUp ? 'up' : 'down',
      },
    });
  }
}
