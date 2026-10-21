import { describe, expect, it } from 'vitest';
import { exponentialBackoffMs } from './backoff';

describe('exponentialBackoffMs', () => {
  it('spreads the first attempt between half and the full base delay', () => {
    expect(exponentialBackoffMs(1, 0, 1000, 60_000)).toBe(500);
    expect(exponentialBackoffMs(1, 0.999, 1000, 60_000)).toBe(1000);
  });

  it('doubles the window and then caps it', () => {
    expect(exponentialBackoffMs(3, 0, 1000, 60_000)).toBe(2000);
    expect(exponentialBackoffMs(20, 0, 1000, 60_000)).toBe(30_000);
  });

  it('rejects an invalid attempt or random unit', () => {
    expect(() => exponentialBackoffMs(0, 0)).toThrow(/attempt/);
    expect(() => exponentialBackoffMs(1, 1)).toThrow(/randomUnit/);
  });
});
