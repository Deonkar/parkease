import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { searchPlaces } from '../api/geocoding';

const MIN_QUERY_LENGTH = 3;
// Nominatim's usage policy caps requests at 1/sec — debounce keeps us well under.
const DEBOUNCE_MS = 400;

export function usePlaceSearch(query: string) {
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(trimmed);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [trimmed]);

  return useQuery({
    queryKey: ['place-search', debounced],
    queryFn: ({ signal }) => searchPlaces(debounced, signal),
    enabled: debounced.length >= MIN_QUERY_LENGTH,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
