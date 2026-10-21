import { describe, expect, it } from 'vitest';
import { planSetSchema } from './contracts';
import { LoadValueError, loadExceedsLimit, normalizeLoad, toCanonicalKilograms } from './load';

describe('planned load', () => {
  it('keeps an entered kilogram value and converts pounds once', () => {
    expect(normalizeLoad('80')).toBe('80.00');
    expect(toCanonicalKilograms('80', 'kg')).toBe('80.00');
    expect(toCanonicalKilograms('100', 'lb')).toBe('45.36');
    expect(normalizeLoad('100')).toBe('100.00');
  });

  it('does not turn an absent load into zero', () => {
    const set = planSetSchema.parse({
      id: '10000000-0000-4000-8000-000000000099',
      setIndex: 1,
      repetitions: 12,
      load: null,
      restSeconds: 90,
    });
    expect(set.load).toBeNull();
    expect(normalizeLoad('0')).toBe('0.00');
    expect(() => normalizeLoad('-1')).toThrow(LoadValueError);
  });

  it('rejects a pound value whose canonical kilograms pass 2000', () => {
    expect(loadExceedsLimit('4409.25', 'lb')).toBe(false);
    expect(toCanonicalKilograms('4409.25', 'lb')).toBe('2000.00');
    expect(loadExceedsLimit('4409.26', 'lb')).toBe(true);
  });
});
