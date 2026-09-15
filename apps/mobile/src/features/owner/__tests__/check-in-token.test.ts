import { describe, expect, it, vi } from 'vitest';

import { bookingIdInToken } from '../api/check-in';

// `check-in.ts` also exports `ownerCheckIn`, which pulls in the axios client and
// through it `react-native`. Under `environment: 'node'` rollup hands that
// module's Flow source to its JS parser and dies with "Expected 'from', got
// 'typeOf'" — pointing at *this* file rather than at react-native (learnings.md).
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/secure-storage', () => ({
  secureStorage: { read: vi.fn(() => Promise.resolve(null)), write: vi.fn(), clear: vi.fn() },
}));

const BOOKING = '0192f1c0-1111-7000-8000-000000000001';
const VALID = `pk1.${BOOKING}.1789459200000.abcDEF123_-xyz`;

/**
 * The scanner reads the booking id out of the token purely to build the route.
 * It is not a trust decision — the server verifies the HMAC and separately
 * asserts the id in the token matches the id in the path — so what matters here
 * is that a stranger's QR is recognised as "not ours" instead of firing a
 * doomed request, and that nothing malformed slips through as a bookingId.
 */
describe('bookingIdInToken', () => {
  it('reads the booking id out of a well-formed reference', () => {
    expect(bookingIdInToken(VALID)).toBe(BOOKING);
  });

  it('tolerates surrounding whitespace from the camera decode', () => {
    expect(bookingIdInToken(`  ${VALID}\n`)).toBe(BOOKING);
  });

  it.each([
    ['a random QR from another app', 'https://example.com/promo'],
    ['a wifi QR', 'WIFI:S:cafe;T:WPA;P:hunter2;;'],
    ['plain text', 'hello'],
    ['empty', ''],
    ['a future format version', VALID.replace('pk1', 'pk2')],
    ['too few parts', `pk1.${BOOKING}.1789459200000`],
    ['too many parts', `${VALID}.extra`],
    ['a non-uuid id', 'pk1.not-a-uuid.1789459200000.sig'],
    ['a non-numeric expiry', `pk1.${BOOKING}.soon.sig`],
    ['an empty signature', `pk1.${BOOKING}.1789459200000.`],
  ])('returns null for %s', (_label, token) => {
    expect(bookingIdInToken(token)).toBeNull();
  });

  it('never returns something that is not a uuid', () => {
    // The return value goes straight into a URL path. Anything that is not a
    // uuid reaching that point would be a path-shaped value from a QR code
    // somebody else printed.
    const candidates = [
      VALID,
      'pk1.../../../admin.1.sig',
      'pk1.0192f1c0-1111-7000-8000-000000000001x.1.sig',
      `pk1.${BOOKING}.1.sig`,
    ];
    for (const token of candidates) {
      const id = bookingIdInToken(token);
      if (id === null) continue;
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
