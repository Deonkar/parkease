import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';

import { toggleSpace } from '../api/spaces';

import { MY_LISTINGS_KEY } from './useMyListings';

export function useToggleSpace(spaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => toggleSpace(spaceId, newIntent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ['owner', 'space', spaceId] });
    },
  });
}
