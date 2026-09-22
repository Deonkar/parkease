import type { ValetJobView } from '@parkease/contracts/valet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Intent } from '@/lib/api';

import {
  acceptOffer,
  advanceJob,
  fetchActiveJob,
  fetchEarnings,
  fetchOffers,
  fetchProfile,
} from '../api/valet';

export const valetKeys = {
  offers: ['valet', 'offers'] as const,
  active: ['valet', 'active'] as const,
  earnings: ['valet', 'earnings'] as const,
  profile: ['valet', 'profile'] as const,
};

/**
 * The offer set, exactly as the server returned it.
 *
 * No client-side distance filter: the server's radius decided this set, and a
 * second, different threshold here would hide jobs the valet was legitimately
 * offered. `enabled` is what stops the query while offline — an offline valet
 * has no offers to poll for, and polling anyway is battery spent on nothing.
 */
export function useOffers(enabled: boolean) {
  return useQuery({
    queryKey: valetKeys.offers,
    queryFn: ({ signal }) => fetchOffers(signal),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useActiveJob() {
  return useQuery({
    queryKey: valetKeys.active,
    queryFn: ({ signal }) => fetchActiveJob(signal),
  });
}

export function useValetEarnings() {
  return useQuery({
    queryKey: valetKeys.earnings,
    queryFn: ({ signal }) => fetchEarnings(signal),
  });
}

export function useValetProfile() {
  return useQuery({
    queryKey: valetKeys.profile,
    queryFn: ({ signal }) => fetchProfile(signal),
  });
}

/**
 * Accept, with one idempotency key per tap.
 *
 * The key is minted by the caller and reused across retries, so a timeout
 * followed by a retry replays the original accept rather than racing a second
 * one (R-FE-05).
 */
export function useAcceptOffer() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, intent }: { jobId: string; intent: Intent }) =>
      acceptOffer(jobId, intent),
    onSettled: () => {
      // Whether we won or lost the race, both lists are now stale.
      void client.invalidateQueries({ queryKey: valetKeys.offers });
      void client.invalidateQueries({ queryKey: valetKeys.active });
    },
  });
}

/**
 * Advance the job by one lifecycle event.
 *
 * The event comes from the server's `availableEvents`, never from a table this
 * app maintains: `valet-job.view.ts` derives that list from the state machine
 * precisely so the app and the server do not each keep a copy that can drift.
 *
 * A rejected transition (`ILLEGAL_VALET_TRANSITION`) invalidates rather than
 * retries, so a stale screen corrects itself to the true status.
 */
export function useAdvanceJob() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, event, intent }: { jobId: string; event: string; intent: Intent }) =>
      advanceJob(jobId, event, intent),
    onSuccess: (job: ValetJobView) => {
      client.setQueryData(valetKeys.active, job);
      void client.invalidateQueries({ queryKey: valetKeys.earnings });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: valetKeys.active });
    },
  });
}
