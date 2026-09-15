import { createHmac, timingSafeEqual } from 'node:crypto';

import { ExpiredBookingReferenceError, InvalidBookingReferenceError } from './errors.js';

const VERSION = 'pk1';
const SEPARATOR = '.';
const PART_COUNT = 4;

export const QR_VALIDITY_MS = 24 * 60 * 60 * 1000;

const hmac = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * `pk1.{bookingId}.{expiresAtMs}.{base64url hmac}` — short enough for a dense QR
 * that still scans from a phone screen in a badly lit basement.
 *
 * The token proves the reference came from us. It does not prove who is holding
 * it, which is why the check-in command re-resolves ownership from the database
 * rather than trusting the id inside (R-SEC-04).
 */
export function signBookingReference(bookingId: string, secret: string, now: Date): string {
  const expiresAt = now.getTime() + QR_VALIDITY_MS;
  const payload = `${VERSION}${SEPARATOR}${bookingId}${SEPARATOR}${String(expiresAt)}`;
  return `${payload}${SEPARATOR}${hmac(payload, secret)}`;
}

export function verifyBookingReference(
  token: string,
  secret: string,
  now: Date,
): { bookingId: string } {
  const parts = token.split(SEPARATOR);
  if (parts.length !== PART_COUNT) throw new InvalidBookingReferenceError();

  const [version, bookingId, expiresAt, signature] = parts as [string, string, string, string];
  if (version !== VERSION) throw new InvalidBookingReferenceError();

  const expected = Buffer.from(
    hmac(`${version}${SEPARATOR}${bookingId}${SEPARATOR}${expiresAt}`, secret),
  );
  const provided = Buffer.from(signature);

  // timingSafeEqual throws a TypeError on unequal lengths, which would surface as
  // a 500 for what is a plainly malformed token. The length check also leaks
  // nothing: the signature length is fixed and public.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new InvalidBookingReferenceError();
  }

  // Signature first, expiry second. A forged token that happens to be old is a
  // forgery, and telling its holder "expired" would confirm the format is right.
  const expiresAtMs = Number(expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new InvalidBookingReferenceError();
  if (expiresAtMs < now.getTime()) throw new ExpiredBookingReferenceError();

  return { bookingId };
}
