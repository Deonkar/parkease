import { z } from 'zod';

/**
 * What a failed washer call said, read by parsing — never by `as` (R-VAL-01).
 *
 * An error reaching a screen may be the API's envelope
 * `{error: {code, message, traceId}}`, a proxy's HTML page, or a transport
 * failure with no response at all; the schema is what tells them apart.
 */
const httpFailureSchema = z.object({
  response: z.object({
    status: z.number().int(),
    data: z.object({ error: z.object({ code: z.string() }) }),
  }),
});

/** Only the status: a refusal need not carry the envelope (a proxy's 404 does not). */
const httpStatusSchema = z.object({ response: z.object({ status: z.number().int() }) });

/** Statuses the server answered with that are nonetheless worth retrying. */
const TRANSIENT_4XX = new Set([408, 429]);

/**
 * The idempotency interceptor's 409 for a key whose first attempt has not
 * finished. It is not an answer about the request: that attempt may still win.
 */
const REQUEST_IN_FLIGHT = 'REQUEST_IN_FLIGHT';

/**
 * The server answered, and the answer is no — retrying the same request cannot
 * change it. A transport failure (no response), a 5xx, a rate limit, a
 * request timeout, or a duplicate that arrived while the first attempt was
 * still running are NOT refusals: pressing the button again may work, so the
 * caller keeps its intent for a replay.
 */
export function isDefiniteRefusal(error: unknown): boolean {
  const parsed = httpStatusSchema.safeParse(error);
  if (!parsed.success) return false;
  const { status } = parsed.data.response;
  if (status < 400 || status >= 500 || TRANSIENT_4XX.has(status)) return false;
  return apiErrorCodeOf(error) !== REQUEST_IN_FLIGHT;
}

export function apiErrorCodeOf(error: unknown): string | null {
  const parsed = httpFailureSchema.safeParse(error);
  return parsed.success ? parsed.data.response.data.error.code : null;
}

/**
 * `GET /washer/profile` answers 404 `WASHER_PROFILE_NOT_FOUND` for a washer who
 * has not registered — a first-run state with a next step, not an error. Both
 * the status AND the domain code are required, so a proxy's 404 page, or a bare
 * Nest 404 (whose code is `'ERROR'`), stays an error.
 */
export function isUnregisteredWasher(error: unknown): boolean {
  const parsed = httpFailureSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.response.status === 404 &&
    parsed.data.response.data.error.code === 'WASHER_PROFILE_NOT_FOUND'
  );
}
