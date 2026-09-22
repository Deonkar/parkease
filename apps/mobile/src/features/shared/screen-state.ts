/**
 * Which of the three states a screen is in (R-FE-08), decided in one place.
 *
 * Extracted because three valet screens made this decision and all three got it
 * wrong the same way: they gated the skeleton on TanStack's `isLoading`, which
 * is `isPending && isFetching` and therefore goes FALSE in the backoff gap
 * between retry attempts. With no data and no error yet, each screen fell
 * through to its empty state and told the valet "No active job" — a definite
 * negative asserted from an unknown.
 *
 * The rule this encodes: **empty is a fact the server reported, never the
 * absence of an answer.**
 */

export interface QueryShape<T> {
  readonly isPending: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly data: T | null | undefined;
}

export type ScreenState = 'loading' | 'error' | 'empty' | 'ready';

export function resolveScreenState<T>(query: QueryShape<T>): ScreenState {
  // `isPending` alone: true until the query has resolved for the first time,
  // and it does not dip during backoff the way `isLoading` does.
  if (query.isPending) return 'loading';
  if (query.isError) return 'error';
  if (query.data === null || query.data === undefined) return 'empty';
  if (Array.isArray(query.data) && query.data.length === 0) return 'empty';
  return 'ready';
}
