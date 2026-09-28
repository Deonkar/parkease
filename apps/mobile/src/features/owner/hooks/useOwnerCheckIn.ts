import { useMutation, useQueryClient } from '@tanstack/react-query';

import { newIntent } from '@/lib/api';

import { ownerCheckIn } from '../api/check-in';

import { ownerKeys } from './useOwnerQueries';

/**
 * Check a scanned driver in.
 *
 * A check-in moves the booking from "Upcoming" to "Active" on its listing and
 * changes the dashboard's today figures, so success refreshes every owner
 * query by the shared prefix rather than naming the three that happen to show
 * it today (I2).
 */
export function useOwnerCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, token }: { bookingId: string; token: string }) =>
      ownerCheckIn(bookingId, token, newIntent()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ownerKeys.all });
    },
  });
}
