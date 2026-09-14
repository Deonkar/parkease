import type { SpaceSummary } from '@parkease/contracts/owner';
import { useQuery } from '@tanstack/react-query';

import { isDevMockSession } from '@/lib/dev-mock';
import { listDevMockSpaces } from '@/lib/dev-mock-store';

import { type PaginatedResponse, fetchMyListings } from '../api/spaces';

export const MY_LISTINGS_KEY = ['owner', 'listings'] as const;

export function useMyListings(page = 1) {
  return useQuery({
    queryKey: [...MY_LISTINGS_KEY, page],
    queryFn: async () => {
      if (await isDevMockSession()) {
        const items = listDevMockSpaces();
        return {
          items,
          meta: { page: 1, limit: 20, total: items.length, totalPages: items.length ? 1 : 0 },
        } satisfies PaginatedResponse<SpaceSummary>;
      }
      return fetchMyListings(page);
    },
  });
}
