import { useRef } from 'react';

import { IntentKeeper, sendIntent, type SendOptions } from '@/features/shared/intent';
import { newIntent, type Intent } from '@/lib/api';

export interface IntentWithReset extends Intent {
  readonly reset: () => void;
  /** The intent for this body: the held key while it is unchanged, a fresh one once it differs (S-115). */
  readonly forBody: (body: unknown) => Intent;
  /**
   * Sends `body` under this intent: replays the key on a retry, waits out a
   * 409 `REQUEST_IN_FLIGHT`, and answers a 409 `REQUEST_ALREADY_APPLIED` with
   * `onAlreadyApplied` (a refetch). The key is spent on success.
   */
  readonly send: <T>(
    body: unknown,
    attempt: (intent: Intent) => Promise<T>,
    onAlreadyApplied: () => Promise<T>,
    options?: SendOptions,
  ) => Promise<T>;
}

/**
 * One intent for the life of the component (R-FE-05), held in a ref so a
 * re-render never mints a key: `useMutation` re-renders as `isPending` flips,
 * and a key minted per render would make the retry a second intent.
 *
 * The returned object is stable. `idempotencyKey` is read at send time, so a
 * caller holding it always sends the current key.
 */
export function useIntent(): IntentWithReset {
  const ref = useRef<IntentWithReset | null>(null);
  ref.current ??= intentHandle(new IntentKeeper(newIntent));
  return ref.current;
}

function intentHandle(keeper: IntentKeeper): IntentWithReset {
  return {
    get idempotencyKey() {
      return keeper.current.idempotencyKey;
    },
    reset: () => {
      keeper.reset();
    },
    forBody: (body) => keeper.forBody(body),
    send: (body, attempt, onAlreadyApplied, options) =>
      sendIntent(keeper, body, attempt, onAlreadyApplied, options),
  };
}
