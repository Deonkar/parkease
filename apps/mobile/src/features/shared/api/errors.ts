import { z } from 'zod';

/**
 * The API's error envelope: `{ error: { code, message, traceId } }`.
 *
 * Parsed, not asserted. An error response is still a response from outside the
 * process, and a screen that reads `error.response.data.error.message` off an
 * unvalidated body renders `undefined` the one time the server returns a proxy
 * error page instead (R-VAL-01).
 */
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    traceId: z.string().optional(),
  }),
});

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly traceId: string | undefined;
  readonly status: number | undefined;
}

const NETWORK_FAILURE: ApiFailure = {
  code: 'NETWORK',
  message: "We couldn't reach ParkEase. Check your connection and try again.",
  traceId: undefined,
  status: undefined,
};

const UNKNOWN_FAILURE: ApiFailure = {
  code: 'UNKNOWN',
  message: 'Something went wrong. Please try again.',
  traceId: undefined,
  status: undefined,
};

/**
 * Turns whatever a mutation rejected with into something a screen can render.
 *
 * Never swallows: an unrecognised shape becomes UNKNOWN with a usable message
 * rather than an empty string, because a swallowed error in a screen is a blank
 * screen the user cannot report (R-FAIL-01).
 */
export function toApiFailure(error: unknown): ApiFailure {
  if (typeof error !== 'object' || error === null) return UNKNOWN_FAILURE;

  const axiosLike = error as {
    response?: { status?: number; data?: unknown };
    request?: unknown;
  };

  if (axiosLike.response === undefined) {
    return axiosLike.request === undefined ? UNKNOWN_FAILURE : NETWORK_FAILURE;
  }

  const parsed = errorEnvelopeSchema.safeParse(axiosLike.response.data);
  if (!parsed.success) {
    return { ...UNKNOWN_FAILURE, status: axiosLike.response.status };
  }

  return {
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    traceId: parsed.data.error.traceId,
    status: axiosLike.response.status,
  };
}

/**
 * Failures the booking flow has a *next step* for, not just a message.
 *
 * Refusing without offering a way forward is what makes a legitimate 409 feel
 * like a defect, so each of these carries the action the screen should render
 * alongside the server's copy.
 */
export type BookingRecovery = 'back-to-search' | 'find-another-spot' | 'retry' | 'none';

export function recoveryFor(failure: ApiFailure): BookingRecovery {
  switch (failure.code) {
    case 'SLOT_UNAVAILABLE':
      return 'back-to-search';
    case 'EXTENSION_CONFLICT':
      return 'find-another-spot';
    case 'NETWORK':
    case 'CONFLICT_RETRY':
      return 'retry';
    default:
      return 'none';
  }
}
