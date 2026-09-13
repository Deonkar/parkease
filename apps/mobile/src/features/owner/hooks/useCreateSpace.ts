import type { CreateSpace } from '@parkease/contracts/owner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';

import { createSpace } from '../api/spaces';

import { MY_LISTINGS_KEY } from './useMyListings';

export function useCreateSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateSpace) => createSpace(body, newIntent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
  });
}
