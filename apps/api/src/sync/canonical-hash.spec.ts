import { hashCanonicalJson } from './canonical-hash';

describe('hashCanonicalJson', () => {
  it('hashes the canonical form, not the original key order', () => {
    expect(hashCanonicalJson({ b: 1, a: 'x' })).toBe(
      'cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246',
    );
  });
});
