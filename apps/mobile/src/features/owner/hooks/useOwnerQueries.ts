import type { OwnerBookingGroup, OwnerEarningsPeriod } from '@parkease/contracts/owner';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchDashboard, fetchEarnings, fetchSpaceBookings, fetchTransactions } from '../api/owner';

export const ownerKeys = {
  dashboard: ['owner', 'dashboard'] as const,
  earnings: (period: OwnerEarningsPeriod) => ['owner', 'earnings', period] as const,
  transactions: (period: OwnerEarningsPeriod) => ['owner', 'transactions', period] as const,
  spaceBookings: (spaceId: string, group: OwnerBookingGroup) =>
    ['owner', 'space', spaceId, 'bookings', group] as const,
};

export function useOwnerDashboard() {
  return useQuery({
    queryKey: ownerKeys.dashboard,
    queryFn: ({ signal }) => fetchDashboard(signal),
  });
}

export function useOwnerEarnings(period: OwnerEarningsPeriod) {
  return useQuery({
    queryKey: ownerKeys.earnings(period),
    queryFn: ({ signal }) => fetchEarnings(period, signal),
  });
}

export function useOwnerTransactions(period: OwnerEarningsPeriod) {
  return useInfiniteQuery({
    queryKey: ownerKeys.transactions(period),
    queryFn: ({ pageParam, signal }) => fetchTransactions(period, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
}

export function useSpaceBookings(spaceId: string, group: OwnerBookingGroup) {
  return useQuery({
    queryKey: ownerKeys.spaceBookings(spaceId, group),
    queryFn: ({ signal }) => fetchSpaceBookings(spaceId, group, signal),
  });
}
