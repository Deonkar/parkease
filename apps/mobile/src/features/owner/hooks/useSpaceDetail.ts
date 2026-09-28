import type { SpaceDetail } from '@parkease/contracts/owner';
import { useQuery } from '@tanstack/react-query';

import { isDevMockSession } from '@/lib/dev-mock';
import { findDevMockSpace } from '@/lib/dev-mock-store';

import { fetchSpaceDetail } from '../api/spaces';

export function useSpaceDetail(spaceId: string) {
  return useQuery({
    queryKey: ['owner', 'space', spaceId],
    queryFn: async (): Promise<SpaceDetail> => {
      if (await isDevMockSession()) {
        const space = findDevMockSpace(spaceId);
        if (space === undefined) {
          throw new Error('That listing is not in this dev session.');
        }
        return space;
      }
      return fetchSpaceDetail(spaceId);
    },
    enabled: spaceId.length > 0,
  });
}
