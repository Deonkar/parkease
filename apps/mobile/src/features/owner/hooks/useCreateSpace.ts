import type { CreateSpace, SpaceDetail } from '@parkease/contracts/owner';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';
import { isDevMockSession } from '@/lib/dev-mock';
import { addDevMockSpace } from '@/lib/dev-mock-store';
import { uuidv7 } from '@/lib/uuid';

import { createSpace } from '../api/spaces';

import { MY_LISTINGS_KEY } from './useMyListings';

export function useCreateSpace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: CreateSpace) => {
      if (await isDevMockSession()) {
        const now = new Date().toISOString();
        const mockSpace: SpaceDetail = {
          id: uuidv7(),
          title: body.title,
          city: body.address.city,
          approvalStatus: 'pending_approval',
          slots: body.slots,
          primaryPhoto: null,
          createdAt: now,
          description: body.description ?? null,
          addressLine: body.address.line,
          landmark: body.address.landmark ?? null,
          pincode: body.address.pincode,
          location: body.location,
          pricing: body.pricing,
          schedule: body.schedule,
          amenities: body.amenities,
          accessInstructions: body.accessInstructions ?? null,
          photos: [],
          submittedAt: now,
          approvedAt: null,
          rejectionReason: null,
        };
        addDevMockSpace(mockSpace);
        return mockSpace;
      }
      return createSpace(body, newIntent());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
  });
}
