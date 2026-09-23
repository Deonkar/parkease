import type { CarwashJobEvent, CarwashServiceName } from '@parkease/contracts/enums';
import type { UpsertWashService, WasherEarningsPeriod } from '@parkease/contracts/washer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Intent } from '@/lib/api';

import { apiErrorCodeOf } from '../api/errors';
import {
  acceptOffer,
  advanceJob,
  attachPhoto,
  fetchActiveJob,
  fetchEarnings,
  fetchMenu,
  fetchOffers,
  fetchProfile,
  upsertService,
} from '../api/washer';

export const washerKeys = {
  offers: ['washer', 'offers'] as const,
  active: ['washer', 'active'] as const,
  earnings: (period: WasherEarningsPeriod) => ['washer', 'earnings', period] as const,
  profile: ['washer', 'profile'] as const,
  menu: ['washer', 'menu'] as const,
};

/**
 * `enabled` stops the poll while offline — an offline partner has no offers to
 * poll for, and polling anyway is battery spent on nothing.
 */
export function useWasherOffers(enabled: boolean) {
  return useQuery({
    queryKey: washerKeys.offers,
    queryFn: ({ signal }) => fetchOffers(signal),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useActiveWash() {
  return useQuery({ queryKey: washerKeys.active, queryFn: ({ signal }) => fetchActiveJob(signal) });
}

export function useWasherEarnings(period: WasherEarningsPeriod) {
  return useQuery({
    queryKey: washerKeys.earnings(period),
    queryFn: ({ signal }) => fetchEarnings(period, signal),
  });
}

export function useWasherProfile() {
  return useQuery({ queryKey: washerKeys.profile, queryFn: ({ signal }) => fetchProfile(signal) });
}

export function useServiceMenu() {
  return useQuery({ queryKey: washerKeys.menu, queryFn: ({ signal }) => fetchMenu(signal) });
}

export function useAcceptWash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, intent }: { jobId: string; intent: Intent }) =>
      acceptOffer(jobId, intent),
    onSettled: () => {
      // Won or lost the race, both lists are stale.
      void client.invalidateQueries({ queryKey: washerKeys.offers });
      void client.invalidateQueries({ queryKey: washerKeys.active });
    },
  });
}

/**
 * The event comes from the server's `availableEvents`, never from a table this
 * app keeps — that is what stops the two drifting. A rejected transition
 * invalidates rather than retries, so a stale screen corrects itself.
 */
export function useAdvanceWash() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      event,
      intent,
    }: {
      jobId: string;
      event: CarwashJobEvent;
      intent: Intent;
    }) => advanceJob(jobId, event, intent),
    onSuccess: (job) => {
      client.setQueryData(washerKeys.active, job);
      void client.invalidateQueries({ queryKey: ['washer', 'earnings'] });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: washerKeys.active });
    },
  });
}

export function useAttachPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      jobId,
      slot,
      photoId,
      intent,
    }: {
      jobId: string;
      slot: 'before' | 'after';
      photoId: string;
      intent: Intent;
    }) => attachPhoto(jobId, slot, photoId, intent),
    onSuccess: (job) => {
      client.setQueryData(washerKeys.active, job);
    },
    onError: (error) => {
      // T7-S1: the job moved past this slot, so the screen was stale. Only this
      // code refetches — a transport failure leaves the cached job alone, so
      // the pair keeps rendering while the partner retries.
      if (apiErrorCodeOf(error) === 'PHOTO_SLOT_CLOSED') {
        void client.invalidateQueries({ queryKey: washerKeys.active });
      }
    },
  });
}

export function useUpsertService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      serviceName,
      input,
      intent,
    }: {
      serviceName: CarwashServiceName;
      input: UpsertWashService;
      intent: Intent;
    }) => upsertService(serviceName, input, intent),
    onSuccess: (menu) => {
      // The endpoint returns the WHOLE menu, so the app never merges by hand.
      client.setQueryData(washerKeys.menu, menu);
    },
  });
}
