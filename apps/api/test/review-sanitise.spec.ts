import { describe, expect, it } from 'vitest';

import { sanitiseComment } from '../src/domains/review/sanitise.js';

describe('sanitiseComment', () => {
  it('passes null through', () => {
    expect(sanitiseComment(null)).toBeNull();
  });

  it('strips control and zero-width characters', () => {
    expect(sanitiseComment('ok\u0000\u0007 gate\u200B was\uFEFF open')).toBe('ok gate was open');
  });

  it('turns whitespace-only into null, not an empty string', () => {
    expect(sanitiseComment('   \n\t  ')).toBeNull();
    expect(sanitiseComment('\u200B\u200C')).toBeNull();
  });

  it('collapses runs of whitespace', () => {
    expect(sanitiseComment('easy     to   find')).toBe('easy  to  find');
  });

  it('does not count zero-width padding toward the length', () => {
    const padded = `${'a'.repeat(500)}${'\u200D'.repeat(400)}`;
    expect([...(sanitiseComment(padded) ?? '')].length).toBe(500);
  });

  it.each([
    "'); DROP TABLE reviews; --",
    '1 OR 1=1',
    '${jndi:ldap://x}',
    '<script>alert(1)</script>',
  ])(
    'stores %s verbatim — escaping is the renderer\u2019s job, injection is closed by parameters',
    (raw) => {
      expect(sanitiseComment(raw)).toBe(raw);
    },
  );
});
