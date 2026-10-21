import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly nodeEnv: string;
  private readonly expectedDatabase: string | undefined;

  constructor(config: ConfigService) {
    const databaseUrl = config.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required.');
    }
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 5000,
      options: '-c search_path=meutreino,public',
    });
    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
    this.nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    this.expectedDatabase = config.get<string>('EXPECTED_DATABASE');
  }

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.nodeEnv;
    const expectedDatabase = this.expectedDatabase;
    const rows = await this.$queryRaw<
      {
        database_name: string;
        connected_user: string;
        superuser: boolean;
        business_table: string | null;
        public_users: string | null;
      }[]
    >`SELECT current_database() AS database_name,
             current_user AS connected_user,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
             to_regclass('meutreino.users')::text AS business_table,
             to_regclass('public.users')::text AS public_users`;
    const row = rows[0];
    if (!row?.business_table) {
      throw new Error('Schema meutreino.users was not found. Refusing to start.');
    }
    if (nodeEnv === 'production') {
      if (!expectedDatabase || row.database_name !== expectedDatabase) {
        throw new Error('Database name does not match EXPECTED_DATABASE. Refusing to start.');
      }
      if (row.superuser) {
        throw new Error('The API must not connect as a superuser in production.');
      }
      if (row.public_users) {
        throw new Error('Business table public.users is still present. Refusing to start.');
      }
    } else if (expectedDatabase && row.database_name !== expectedDatabase) {
      throw new Error('Database name does not match EXPECTED_DATABASE. Refusing to start.');
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(safeDatabaseDiagnostic(error));
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }
}

function safeDatabaseDiagnostic(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown database error';
  if (/postgres(ql)?:\/\//i.test(text) || /password/i.test(text)) {
    return 'Database health check failed.';
  }
  return `Database health check failed. ${text}`;
}
