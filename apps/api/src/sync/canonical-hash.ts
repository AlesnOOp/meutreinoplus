import { createHash } from 'node:crypto';
import { canonicalJsonString } from '@meutreino/shared';

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJsonString(value), 'utf8').digest('hex');
}
