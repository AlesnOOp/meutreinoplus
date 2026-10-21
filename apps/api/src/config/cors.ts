const LOCAL_ORIGIN = /^(https?:\/\/[A-Za-z0-9._:-]+|exp:\/\/[A-Za-z0-9._:-]+)$/;

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function resolveCorsOrigins(origins: readonly string[]): string[] | false {
  if (origins.length === 0) {
    return false;
  }

  for (const origin of origins) {
    if (origin === '*' || !LOCAL_ORIGIN.test(origin)) {
      throw new Error(`CORS origin is not allowed: ${origin}`);
    }
  }

  return [...origins];
}
