import { healthReportSchema } from '@meutreino/shared';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  function service(up: boolean): HealthService {
    const database = {
      ping: async () => up,
    } as PrismaService;
    return new HealthService(database);
  }

  it('reports ok when postgres answers', async () => {
    const report = await service(true).getReport(new Date('2026-10-20T18:00:00.000Z'));
    expect(report.status).toBe('ok');
    expect(report.checks.database).toBe('up');
    expect(healthReportSchema.parse(report)).toEqual(report);
  });

  it('reports degraded when postgres does not answer', async () => {
    const report = await service(false).getReport(new Date('2026-10-20T18:00:00.000Z'));
    expect(report).toMatchObject({
      status: 'degraded',
      service: 'meutreino-api',
      checks: { database: 'down' },
    });
  });
});
