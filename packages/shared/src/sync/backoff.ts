export function exponentialBackoffMs(
  attempt: number,
  randomUnit: number,
  baseMs = 1000,
  maxMs = 60_000,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be an integer greater than or equal to 1.');
  }
  if (!(randomUnit >= 0 && randomUnit < 1)) {
    throw new Error('randomUnit must be within [0, 1).');
  }
  if (!(baseMs > 0) || !(maxMs >= baseMs)) {
    throw new Error('maxMs must be greater than or equal to a positive baseMs.');
  }

  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exponential * (0.5 + randomUnit * 0.5));
}
