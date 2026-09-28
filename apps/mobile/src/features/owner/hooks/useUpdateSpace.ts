import type { UpdateSpace } from '@parkease/contracts/owner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';

import { updateSpace } from '../api/spaces';

import { MY_LISTINGS_KEY } from './useMyListings';
import { ownerKeys } from './useOwnerQueries';

export function useUpdateSpace(spaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateSpace) => updateSpace(spaceId, body, newIntent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['owner', 'space', spaceId] });
      // Slot counts, pricing and title all surface on the dashboard too (F7).
      void queryClient.invalidateQueries({ queryKey: ownerKeys.dashboard });
    },
  });
}
