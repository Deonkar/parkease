import { useQuery } from '@tanstack/react-query';

import { fetchMyListings } from '../api/spaces';

export const MY_LISTINGS_KEY = ['owner', 'listings'] as const;

export function useMyListings(page = 1) {
  return useQuery({
    queryKey: [...MY_LISTINGS_KEY, page],
    queryFn: () => fetchMyListings(page),
  });
}
