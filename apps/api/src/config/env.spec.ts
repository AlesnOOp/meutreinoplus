import { parseEnv } from './env';

describe('parseEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://meutreino:meutreino@localhost:5432/meutreino',
    CORS_ORIGINS: 'http://localhost:8081',
    LOG_LEVEL: 'error',
  };

  it('accepts the local development contract', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.corsOrigins).toEqual(['http://localhost:8081']);
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => parseEnv({ ...valid, CORS_ORIGINS: '*' })).toThrow(/not allowed/);
  });

  it('rejects a non-postgres database url', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost/meutreino' })).toThrow(
      /PostgreSQL/,
    );
  });

  it('denies browser origins when the list is empty', () => {
    expect(parseEnv({ ...valid, CORS_ORIGINS: '' }).corsOrigins).toBe(false);
  });
});
