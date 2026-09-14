import type { UpdateSpace } from '@parkease/contracts/owner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';

import { updateSpace } from '../api/spaces';

import { MY_LISTINGS_KEY } from './useMyListings';

export function useUpdateSpace(spaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateSpace) => updateSpace(spaceId, body, newIntent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['owner', 'space', spaceId] });
    },
  });
}
