import type { SubmitRouteOnboarding, UpdateBankDetails } from '@parkease/contracts/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useIntent } from '../hooks/useIntent';

import {
  fetchBankDetails,
  fetchPayoutSummary,
  fetchPayouts,
  fetchRouteOnboarding,
  saveBankDetails,
  submitRouteOnboarding,
} from './api';

export const getPaidKeys = {
  all: ['getPaid'] as const,
  route: ['getPaid', 'route'] as const,
  summary: ['getPaid', 'summary'] as const,
  payouts: ['getPaid', 'payouts'] as const,
  bank: ['getPaid', 'bank'] as const,
};

export function useRouteOnboarding() {
  return useQuery({
    queryKey: getPaidKeys.route,
    queryFn: ({ signal }) => fetchRouteOnboarding(signal),
  });
}

/**
 * One Idempotency-Key per submit intent (R-FE-05): a retry after a timeout replays the same
 * submission instead of sending the KYC steps twice; a successful submit mints the next key.
 */
export function useSubmitRouteOnboarding() {
  const queryClient = useQueryClient();
  const intent = useIntent();
  return useMutation({
    mutationFn: (form: SubmitRouteOnboarding) => submitRouteOnboarding(form, intent),
    onSuccess: (view) => {
      intent.reset();
      queryClient.setQueryData(getPaidKeys.route, view);
    },
  });
}

export function usePayoutSummary() {
  return useQuery({
    queryKey: getPaidKeys.summary,
    queryFn: ({ signal }) => fetchPayoutSummary(signal),
  });
}

export function usePayouts() {
  return useInfiniteQuery({
    queryKey: getPaidKeys.payouts,
    queryFn: ({ pageParam, signal }) => fetchPayouts(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
}

export function useBankDetails() {
  return useQuery({
    queryKey: getPaidKeys.bank,
    queryFn: ({ signal }) => fetchBankDetails(signal),
  });
}

/** A bank change cancels unsent payouts server-side, so the history is refetched too. */
export function useSaveBankDetails() {
  const queryClient = useQueryClient();
  const intent = useIntent();
  return useMutation({
    mutationFn: (form: UpdateBankDetails) => saveBankDetails(form, intent),
    onSuccess: (view) => {
      intent.reset();
      queryClient.setQueryData(getPaidKeys.bank, view);
      void queryClient.invalidateQueries({ queryKey: getPaidKeys.payouts });
      void queryClient.invalidateQueries({ queryKey: getPaidKeys.summary });
    },
  });
}
