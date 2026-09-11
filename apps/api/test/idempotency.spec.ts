import { describe, it, expect } from 'vitest';

import { hashCanonicalBody } from '../src/platform/idempotency/idempotency.service.js';

describe('hashCanonicalBody', () => {
  it('produces the same hash regardless of key ordering', () => {
    const a = hashCanonicalBody({ z: 1, a: 2, m: 3 });
    const b = hashCanonicalBody({ a: 2, m: 3, z: 1 });
    expect(a).toBe(b);
  });

  it('produces different hashes for different values', () => {
    const a = hashCanonicalBody({ a: 1 });
    const b = hashCanonicalBody({ a: 2 });
    expect(a).not.toBe(b);
  });

  it('handles nested objects with key ordering', () => {
    const a = hashCanonicalBody({ outer: { z: 1, a: 2 } });
    const b = hashCanonicalBody({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('handles arrays (preserving order)', () => {
    const a = hashCanonicalBody({ items: [1, 2, 3] });
    const b = hashCanonicalBody({ items: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it('handles null and primitives', () => {
    expect(hashCanonicalBody(null)).toBe(hashCanonicalBody(null));
    expect(hashCanonicalBody('hello')).toBe(hashCanonicalBody('hello'));
    expect(hashCanonicalBody(42)).toBe(hashCanonicalBody(42));
  });
});
