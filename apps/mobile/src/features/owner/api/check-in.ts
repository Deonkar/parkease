import { ownerCheckInResultSchema, type OwnerCheckInResult } from '@parkease/contracts/owner';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

const envelopeSchema = z.object({ data: ownerCheckInResultSchema });

/**
 * Scan a driver's QR and check them in.
 *
 * The scanned string goes to the server unparsed and unopened. The app does not
 * hold the signing secret and must not try to read the token: verification is
 * the server's, and an app that "helpfully" pre-validates a signature it cannot
 * check would only teach owners to trust a green tick it invented.
 */
export async function ownerCheckIn(
  bookingId: string,
  token: string,
  intent: Intent,
): Promise<OwnerCheckInResult> {
  const response = await api.post<unknown>(
    `/owner/bookings/${bookingId}/check-in`,
    { token },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelopeSchema.parse(response.data).data;
}

/**
 * The booking id lives inside the token, and the route needs it in the path.
 *
 * Reading it here is a routing convenience, not a trust decision: the server
 * verifies the HMAC and separately asserts that the id in the token matches the
 * id in the path, so a tampered id fails there. Returns null for anything that
 * is not shaped like one of our references, so the scanner can say "that is not
 * a ParkEase code" instead of firing a doomed request.
 */
const REFERENCE = /^pk1\.([0-9a-f-]{36})\.\d+\.[A-Za-z0-9_-]+$/;

export function bookingIdInToken(token: string): string | null {
  const match = REFERENCE.exec(token.trim());
  return match?.[1] ?? null;
}
