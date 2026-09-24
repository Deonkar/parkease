import { z } from 'zod';

import { assertNever } from '@/lib/assert-never';

/**
 * What a failed washer call said, read by parsing — never by `as` (R-VAL-01).
 *
 * The ONE place a failure is classified (G1). An error reaching a screen may be
 * the API's envelope `{error: {code, message, traceId}}`, a proxy's HTML page,
 * a transport failure with no response at all, or a 2xx whose body this build
 * could not parse; the schemas below are what tell them apart, and every screen
 * and hook reads the answer through the helpers in this file.
 */
const httpFailureSchema = z.object({
  response: z.object({
    status: z.number().int(),
    data: z.object({ error: z.object({ code: z.string() }) }),
  }),
});

/** The envelope's human message, when the server sent one. */
const httpMessageSchema = z.object({
  response: z.object({
    data: z.object({ error: z.object({ message: z.string().min(1) }) }),
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
 * Every failure is one of four things, and each is told differently.
 *
 * - `outdated`: a 2xx (or a request body) this build's contract could not
 *   parse — the app is out of date. The server may well have done the thing,
 *   so the intent is dropped and the caches refetched; the words say "Update
 *   the app", never "check your connection".
 * - `in-flight`: 409 `REQUEST_IN_FLIGHT` — the first attempt is still being
 *   processed. The intent is KEPT, so the next press replays it.
 * - `refused`: a definite 4xx. Retrying the same request cannot change it.
 * - `unreachable`: no response, a 5xx, a 408 or a 429. A retry may work.
 */
export type FailureKind = 'outdated' | 'in-flight' | 'refused' | 'unreachable';

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof z.ZodError) return 'outdated';
  const status = httpStatusOf(error);
  if (status === null) return 'unreachable';
  if (status < 400 || status >= 500 || TRANSIENT_4XX.has(status)) return 'unreachable';
  return apiErrorCodeOf(error) === REQUEST_IN_FLIGHT ? 'in-flight' : 'refused';
}

/**
 * The server answered, and the answer is no — retrying the same request cannot
 * change it. A transport failure (no response), a 5xx, a rate limit, a
 * request timeout, or a duplicate that arrived while the first attempt was
 * still running are NOT refusals: pressing the button again may work, so the
 * caller keeps its intent for a replay.
 */
export function isDefiniteRefusal(error: unknown): boolean {
  return classifyFailure(error) === 'refused';
}

/**
 * Whether the server has answered for good, so the intent's key must not be
 * replayed and the affected caches should be refetched: a refusal, or a 2xx
 * this build could not read.
 */
export function settlesIntent(error: unknown): boolean {
  const kind = classifyFailure(error);
  return kind === 'refused' || kind === 'outdated';
}

/** The HTTP status the server answered with, or `null` when none arrived. */
export function httpStatusOf(error: unknown): number | null {
  const parsed = httpStatusSchema.safeParse(error);
  return parsed.success ? parsed.data.response.status : null;
}

export function apiErrorCodeOf(error: unknown): string | null {
  const parsed = httpFailureSchema.safeParse(error);
  return parsed.success ? parsed.data.response.data.error.code : null;
}

/** The server's own words for a refusal, or `null` when it sent none. */
export function serverMessageOf(error: unknown): string | null {
  const parsed = httpMessageSchema.safeParse(error);
  return parsed.success ? parsed.data.response.data.error.message : null;
}

export const OUTDATED_COPY = 'This version of ParkEase is out of date. Update the app to continue.';

export const IN_FLIGHT_COPY =
  'Your first attempt is still being processed. Wait a moment, then try again.';

const LOAD_UNREACHABLE = 'Check your connection and try again.';

/**
 * The words for a failed action. The caller owns what a refusal and a dead
 * connection mean for ITS action; the two classes that mean the same thing
 * everywhere are said here, once.
 */
export function failureCopy(
  error: unknown,
  copy: { readonly refused: string; readonly unreachable: string },
): string {
  const kind = classifyFailure(error);
  switch (kind) {
    case 'outdated':
      return OUTDATED_COPY;
    case 'in-flight':
      return IN_FLIGHT_COPY;
    case 'refused':
      return copy.refused;
    case 'unreachable':
      return copy.unreachable;
    default:
      return assertNever(kind);
  }
}

/** The body of a screen's error state: out of date, or the connection. */
export function loadFailureCopy(error: unknown): string {
  return classifyFailure(error) === 'outdated' ? OUTDATED_COPY : LOAD_UNREACHABLE;
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
