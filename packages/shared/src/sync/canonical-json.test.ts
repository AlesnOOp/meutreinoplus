import { describe, expect, it } from 'vitest';
import { canonicalJsonString } from './canonical-json';

describe('canonicalJsonString', () => {
  it('sorts object keys and keeps array order', () => {
    expect(canonicalJsonString({ b: 1, a: 'x', nested: { z: true, y: null } })).toBe(
      '{"a":"x","b":1,"nested":{"y":null,"z":true}}',
    );
    expect(canonicalJsonString(['b', 'a'])).toBe('["b","a"]');
  });

  it('rejects floats, unsafe integers, and undefined properties', () => {
    expect(() => canonicalJsonString(1.5)).toThrow(/safe integers/);
    expect(() => canonicalJsonString({ load: undefined })).toThrow(/undefined/);
  });
});
