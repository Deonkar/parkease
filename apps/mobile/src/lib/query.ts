import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

import { classifyFailure } from '@/features/shared/api/failure';

/** How many times a failed query is retried before its error state shows. */
const MAX_QUERY_RETRIES = 2;

/**
 * Retry only what a retry can fix (S-76). The shared classifier (G1) is the one
 * place a failure is read: a transport failure, a 5xx, a 408 or a 429 is
 * `unreachable` and worth another try. A definite 4xx is final, and so is a 2xx
 * this build cannot parse (a `ZodError`, `outdated`): fetching the same
 * unreadable body twice more only holds the skeleton on screen before "Update
 * the app" shows.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return classifyFailure(error) === 'unreachable';
}

/** Every intent replays in one queue, so they reach the server in the order they were made. */
export const INTENT_QUEUE_SCOPE = 'user-intents';

export const queryDefaults = {
  queries: {
    retry: shouldRetryQuery,
    staleTime: 30_000,
  },
  mutations: {
    retry: false,
    // Offline, an intent pauses and replays on reconnect in the order it was made (S-150).
    networkMode: 'online',
    scope: { id: INTENT_QUEUE_SCOPE },
  },
} satisfies DefaultOptions;

export const queryClient = new QueryClient({ defaultOptions: queryDefaults });
