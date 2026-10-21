import type { ColorSchemeName } from './colors';

export function resolveColorScheme(
  preference: 'system' | 'light' | 'dark',
  systemScheme: 'light' | 'dark' | null | undefined,
): ColorSchemeName {
  if (preference === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return preference;
}
