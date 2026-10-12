import { apiErrorCodeOf } from '@/features/shared/api/failure';
import type { Intent } from '@/lib/api';

/**
 * The idempotency rules every mutation shares (R-FE-05, ADR-011), outside
 * React so they can be tested as plain functions. `useIntent` is the hook face.
 *
 * - **One key per intent, not per attempt.** A retry of the same body replays
 *   the same key, so a lost response never books twice.
 * - **A changed body is a new intent (S-115).** The key is tied to a hash of
 *   the body it was first sent with. If the server committed and the answer
 *   was lost, and the user then edits the form and sends again, the old key
 *   would come back with a new body: a 422 "Something changed in that request"
 *   on every retry until they left the screen.
 * - **409 `REQUEST_IN_FLIGHT`**: the first attempt is still running. Wait a
 *   moment and send again with the SAME key; that attempt may still win.
 * - **409 `REQUEST_ALREADY_APPLIED`**: the first attempt committed and its
 *   answer was lost. It is a success: the caller refetches the result instead
 *   of showing an error, and the key is spent.
 */

/** The interceptor's 409 for a key whose first attempt has not finished. */
export const REQUEST_IN_FLIGHT = 'REQUEST_IN_FLIGHT';
/** The interceptor's 409 for a key whose first attempt committed (S-64). */
export const REQUEST_ALREADY_APPLIED = 'REQUEST_ALREADY_APPLIED';

/** How long to wait before re-sending an in-flight request, and how often. */
export const IN_FLIGHT_DELAY_MS = 1_000;
export const MAX_IN_FLIGHT_WAITS = 3;

/**
 * A stable hash of a request body: the same fields in any key order hash the
 * same, so a re-render that rebuilds the object does not mint a new key.
 * cyrb53, not a cryptographic hash: it only has to tell an edit from a retry.
 */
export function bodyHash(body: unknown): string {
  const text = canonical(body);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function canonical(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`;
}

/** Holds one intent's key and the hash of the body it was first sent with. */
export class IntentKeeper {
  private intent: Intent;
  private hash: string | null = null;

  constructor(private readonly mint: () => Intent) {
    this.intent = mint();
  }

  get current(): Intent {
    return this.intent;
  }

  /** The key for this body: the held one while the body is unchanged, a fresh one once it differs. */
  forBody(body: unknown): Intent {
    const hash = bodyHash(body);
    if (this.hash !== null && this.hash !== hash) this.intent = this.mint();
    this.hash = hash;
    return this.intent;
  }

  /** The intent is spent: the next send is a new one. */
  reset(): void {
    this.intent = this.mint();
    this.hash = null;
  }
}

export interface SendOptions {
  readonly sleep?: (ms: number) => Promise<void>;
  readonly inFlightDelayMs?: number;
  readonly maxInFlightWaits?: number;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Sends one intent to its answer.
 *
 * `attempt` makes the request with the key it is given. `onAlreadyApplied`
 * produces the result when the server says an earlier attempt committed: a
 * refetch of what the write produced. Any other failure is thrown as it came,
 * with the key KEPT, so "Try again" with the same body replays the same intent.
 */
export async function sendIntent<T>(
  keeper: IntentKeeper,
  body: unknown,
  attempt: (intent: Intent) => Promise<T>,
  onAlreadyApplied: () => Promise<T>,
  options: SendOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? wait;
  const delay = options.inFlightDelayMs ?? IN_FLIGHT_DELAY_MS;
  const maxWaits = options.maxInFlightWaits ?? MAX_IN_FLIGHT_WAITS;
  const intent = keeper.forBody(body);

  for (let waits = 0; ; waits += 1) {
    try {
      const result = await attempt(intent);
      keeper.reset();
      return result;
    } catch (error) {
      const code = apiErrorCodeOf(error);
      if (code === REQUEST_ALREADY_APPLIED) {
        keeper.reset();
        return onAlreadyApplied();
      }
      if (code === REQUEST_IN_FLIGHT && waits < maxWaits) {
        await sleep(delay * (waits + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Thrown by an `onAlreadyApplied` that cannot find what the earlier attempt
 * made. The write happened; the screen should refresh, not offer a retry.
 */
export class AlreadyAppliedError extends Error {
  constructor() {
    super('That request already went through. Refresh to see the result.');
    this.name = 'AlreadyAppliedError';
  }
}
