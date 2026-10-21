import { resolve, sep } from 'node:path';

export function safeJoin(root: string, key: string): string {
  if (key.includes('\0') || key.split(/[\\/]/).includes('..')) {
    throw new Error('Storage key is not allowed.');
  }
  const base = resolve(root);
  const target = resolve(base, key);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error('Storage key escapes the root.');
  }
  return target;
}
