import { describe, expect, it } from 'vitest';

import {
  ExpiredBookingReferenceError,
  InvalidBookingReferenceError,
} from '../src/domains/booking/errors.js';
import {
  QR_VALIDITY_MS,
  signBookingReference,
  verifyBookingReference,
} from '../src/domains/booking/qr.js';

const SECRET = 'a-booking-qr-secret-that-is-long-enough-to-be-real';
const OTHER_SECRET = 'a-different-secret-of-a-similar-sort-of-length-ok';
const BOOKING_ID = '0192f1c0-1111-7000-8000-000000000001';
const NOW = new Date('2026-10-05T10:00:00.000Z');

describe('booking QR reference', () => {
  it('round-trips the booking id', () => {
    const token = signBookingReference(BOOKING_ID, SECRET, NOW);
    expect(verifyBookingReference(token, SECRET, NOW)).toEqual({ bookingId: BOOKING_ID });
  });

  it('is short enough to stay a dense, scannable QR', () => {
    expect(signBookingReference(BOOKING_ID, SECRET, NOW).length).toBeLessThan(120);
  });

  it('carries no readable payload beyond the id it is meant to carry', () => {
    const token = signBookingReference(BOOKING_ID, SECRET, NOW);
    const [version, bookingId, expiresAt, signature] = token.split('.');
    expect(version).toBe('pk1');
    expect(bookingId).toBe(BOOKING_ID);
    expect(Number(expiresAt)).toBe(NOW.getTime() + QR_VALIDITY_MS);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  describe('rejects', () => {
    it('a token signed with a different secret', () => {
      const token = signBookingReference(BOOKING_ID, OTHER_SECRET, NOW);
      expect(() => verifyBookingReference(token, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it('a token whose booking id was swapped', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      const tampered = token.replace(BOOKING_ID, '0192f1c0-1111-7000-8000-000000000002');
      expect(() => verifyBookingReference(tampered, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it('a token whose expiry was pushed out', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      const parts = token.split('.');
      const tampered = [parts[0], parts[1], String(Number(parts[2]) + 86_400_000), parts[3]].join(
        '.',
      );
      expect(() => verifyBookingReference(tampered, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it('a token with one character of the signature flipped', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      expect(() => verifyBookingReference(flipped, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it('a token with a truncated signature, rather than throwing on length', () => {
      // timingSafeEqual throws a TypeError on unequal lengths. That must surface
      // as our 400, not as a 500.
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      expect(() => verifyBookingReference(token.slice(0, -4), SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it('a token from a future format version', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      expect(() => verifyBookingReference(`pk2${token.slice(3)}`, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });

    it.each([
      ['empty', ''],
      ['not a token at all', 'hello'],
      ['too few parts', 'pk1.abc.123'],
      ['too many parts', 'pk1.abc.123.sig.extra'],
    ])('a malformed token: %s', (_label, token) => {
      expect(() => verifyBookingReference(token, SECRET, NOW)).toThrow(
        InvalidBookingReferenceError,
      );
    });
  });

  describe('expiry', () => {
    it('accepts a token one millisecond before it expires', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      const justBefore = new Date(NOW.getTime() + QR_VALIDITY_MS - 1);
      expect(verifyBookingReference(token, SECRET, justBefore)).toEqual({ bookingId: BOOKING_ID });
    });

    it('rejects a token once it has expired, distinctly from a bad one', () => {
      const token = signBookingReference(BOOKING_ID, SECRET, NOW);
      const after = new Date(NOW.getTime() + QR_VALIDITY_MS + 1);
      expect(() => verifyBookingReference(token, SECRET, after)).toThrow(
        ExpiredBookingReferenceError,
      );
    });

    it('checks the signature before the expiry, so an expired forgery reads as a forgery', () => {
      const token = signBookingReference(BOOKING_ID, OTHER_SECRET, NOW);
      const after = new Date(NOW.getTime() + QR_VALIDITY_MS + 1);
      expect(() => verifyBookingReference(token, SECRET, after)).toThrow(
        InvalidBookingReferenceError,
      );
    });
  });
});
