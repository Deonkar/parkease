import { describe, expect, it } from 'vitest';

import { resolveScreenState } from '../screen-state';

/**
 * The regression guard for a bug found by opening the app, not by a test.
 *
 * TanStack v5's `isLoading` is `isPending && isFetching`, so it goes FALSE in
 * the backoff gap between retry attempts while there is still no data. Three
 * valet screens gated their skeleton on `isLoading` and their empty state on
 * `data == null`, so during that gap they rendered "No active job" — reporting
 * a definite negative when the truth was "not known yet".
 *
 * A valet reading "No active job" mid-shift, while holding someone's car keys,
 * is exactly the silent failure R-FAIL-01 exists to prevent.
 */
describe('resolveScreenState', () => {
  it('is loading on the first fetch, before anything is known', () => {
    expect(
      resolveScreenState({ isPending: true, isFetching: true, isError: false, data: undefined }),
    ).toBe('loading');
  });

  it('stays loading in the backoff gap between retries', () => {
    // The bug: isFetching false, isPending true, no data, no error yet.
    expect(
      resolveScreenState({ isPending: true, isFetching: false, isError: false, data: undefined }),
    ).toBe('loading');
  });

  it('is an error once the retries are exhausted', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: false, isError: true, data: undefined }),
    ).toBe('error');
  });

  it('is empty only when the query actually succeeded with nothing', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: false, isError: false, data: null }),
    ).toBe('empty');
  });

  it('is ready when data arrived', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: false, isError: false, data: { id: 1 } }),
    ).toBe('ready');
  });

  it('treats an empty list as empty, not as ready', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: false, isError: false, data: [] }),
    ).toBe('empty');
  });

  it('reports the error even while a background refetch is in flight', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: true, isError: true, data: undefined }),
    ).toBe('error');
  });

  it('keeps showing data during a background refetch rather than flashing a skeleton', () => {
    expect(
      resolveScreenState({ isPending: false, isFetching: true, isError: false, data: { id: 1 } }),
    ).toBe('ready');
  });
});
