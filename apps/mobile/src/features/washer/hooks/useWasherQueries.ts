import type { CarwashJobEvent, CarwashServiceName } from '@parkease/contracts/enums';
import type {
  CreateWasherProfile,
  SubmitWasherDocuments,
  UpsertWashService,
  WasherEarningsPeriod,
} from '@parkease/contracts/washer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Intent } from '@/lib/api';

import { apiErrorCodeOf, classifyFailure, settlesIntent } from '../api/errors';
import {
  acceptOffer,
  advanceJob,
  attachPhoto,
  createProfile,
  fetchActiveJob,
  fetchEarnings,
  fetchMenu,
  fetchOffers,
  fetchProfile,
  submitDocuments,
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
    onError: (error) => {
      // Not verified, not onboarded: facts the profile holds, and the lock on
      // every other card reads them (G3).
      if (settlesIntent(error)) {
        void client.invalidateQueries({ queryKey: washerKeys.profile });
      }
    },
  });
}

/**
 * The event comes from the server's `availableEvents`, never from a table this
 * app keeps — that is what stops the two drifting. A rejected transition
 * invalidates rather than retries, so a stale screen corrects itself.
 *
 * Only a DEFINITE refusal invalidates (ruling T7-I2). A transport failure or a
 * 5xx says nothing about the job, and a refetch over the same dead connection
 * fails too — which used to swap the live job for an error screen at the moment
 * the partner pressed Start Washing with no signal.
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
    onError: (error) => {
      // A refusal, or a 2xx this build could not read (G1): either way the
      // server has answered, and the cached job is stale.
      if (settlesIntent(error)) {
        void client.invalidateQueries({ queryKey: washerKeys.active });
      }
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
      if (apiErrorCodeOf(error) === 'PHOTO_SLOT_CLOSED' || classifyFailure(error) === 'outdated') {
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
    onError: (error) => {
      // The save may have landed with an answer this build cannot read (G1).
      if (classifyFailure(error) === 'outdated') {
        void client.invalidateQueries({ queryKey: washerKeys.menu });
      }
    },
  });
}

/**
 * Registering. The profile AND the menu are new on the server — registration
 * seeds the menu with the ticked services switched on (ruling T10-S1) — so
 * both caches are stale the moment it succeeds.
 */
export function useCreateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, intent }: { input: CreateWasherProfile; intent: Intent }) =>
      createProfile(input, intent),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: washerKeys.profile });
      void client.invalidateQueries({ queryKey: washerKeys.menu });
    },
    onError: (error) => {
      if (classifyFailure(error) === 'outdated') {
        void client.invalidateQueries({ queryKey: washerKeys.profile });
        void client.invalidateQueries({ queryKey: washerKeys.menu });
      }
    },
  });
}

/** The ID image for review. Moves verification to `pending` on the server. */
export function useSubmitDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ input, intent }: { input: SubmitWasherDocuments; intent: Intent }) =>
      submitDocuments(input, intent),
    onSuccess: (profile) => {
      client.setQueryData(washerKeys.profile, profile);
    },
    onError: (error) => {
      if (classifyFailure(error) === 'outdated') {
        void client.invalidateQueries({ queryKey: washerKeys.profile });
      }
    },
  });
}
