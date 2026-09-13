import { useQuery } from '@tanstack/react-query';

import { fetchSpaceDetail } from '../api/spaces';

export function useSpaceDetail(spaceId: string) {
  return useQuery({
    queryKey: ['owner', 'space', spaceId],
    queryFn: () => fetchSpaceDetail(spaceId),
    enabled: spaceId.length > 0,
  });
}
