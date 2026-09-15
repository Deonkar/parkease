import { useInfiniteQuery } from '@tanstack/react-query';

import { isDevMockSession } from '@/lib/dev-mock';

import { devSearchSpaces } from '../api/dev-fixtures';
import { searchSpaces, type SpaceSearchPage } from '../api/spaces';

import { toSearchParams, type SearchFilters, type SearchOrigin } from './useSearchFilters';

export const SPACE_SEARCH_KEY = ['driver', 'spaces'] as const;

/**
 * Server state for discovery. Results live in the query cache and are read
 * straight from it — never copied into useState (R-FE-02), which is also why
 * the map/list toggle can swap renderers without refetching.
 */
export function useSpaceSearch(origin: SearchOrigin | null, filters: SearchFilters) {
  const params = origin ? toSearchParams(origin, filters) : null;

  return useInfiniteQuery({
    queryKey: [...SPACE_SEARCH_KEY, params],
    enabled: params !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<SpaceSearchPage> => {
      if (!params) throw new Error('Search ran without an origin');

      const withCursor = pageParam === undefined ? params : { ...params, cursor: pageParam };

      if (await isDevMockSession()) {
        return devSearchSpaces(withCursor);
      }
      return searchSpaces(withCursor, signal);
    },
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor,
    // Availability is never cached — a stale free-slot count is a double
    // booking or a lost sale (rules.md R-PERF-05). Overrides the 30s default.
    staleTime: 0,
  });
}
