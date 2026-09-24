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
 * The rules this encodes:
 *
 * - **Empty is a fact the server reported, never the absence of an answer.** A
 *   cached `null` or `[]` behind a failed refetch is therefore an error, not
 *   empty: the latest answer was a failure, so "nothing here" is unknown.
 * - **Data on screen stays on screen when a refetch fails** (ruling T7-I2).
 *   TanStack keeps the last good data and sets `isError`; swapping it for a
 *   full-screen error hid a live wash job from its partner because a Start
 *   Washing pressed with no signal invalidated the query and the refetch failed
 *   too. A screen that wants to say the refresh failed checks `isError` beside
 *   `ready` and shows a non-blocking notice.
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
  if (hasContent(query.data)) return 'ready';
  if (query.isError) return 'error';
  return 'empty';
}

/** Something to show: a value, or a list with at least one item in it. */
function hasContent(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  return !Array.isArray(data) || data.length > 0;
}
