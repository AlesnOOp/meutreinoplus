import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_VERSION } from './version';

describe('API_VERSION', () => {
  it('matches the API package version', () => {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
      version: string;
    };
    expect(packageJson.version).toBe(API_VERSION);
  });
});
