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

export function apiErrorCodeOf(error: unknown): string | null {
  const parsed = httpFailureSchema.safeParse(error);
  return parsed.success ? parsed.data.response.data.error.code : null;
}

/**
 * `GET /washer/profile` answers 404 `NOT_FOUND` for a washer who has not
 * registered — a first-run state with a next step, not an error. Both the status
 * AND the envelope code are required, so a proxy's 404 page stays an error.
 */
export function isUnregisteredWasher(error: unknown): boolean {
  const parsed = httpFailureSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.response.status === 404 &&
    parsed.data.response.data.error.code === 'NOT_FOUND'
  );
}
