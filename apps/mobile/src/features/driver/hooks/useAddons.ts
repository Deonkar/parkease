import type { DriverValetJob, DriverWashJob, WashPaymentOrder } from '@parkease/contracts/driver';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { toApiFailure } from '@/features/shared/api/errors';
import { useIntent } from '@/features/shared/hooks/useIntent';
import { warn } from '@/lib/log';

import { valetIsLive, washIsLive } from '../addon-copy';
import {
  type BookingAddons,
  mergeAddons,
  readBookingAddons,
  rememberValetJob,
  rememberWashJob,
  rememberWashPaid,
} from '../addon-store';
import {
  cancelValet,
  cancelWash,
  createWashOrder,
  fetchBookingAddons,
  fetchValetJob,
  fetchWashJob,
  type MeetingPoint,
  requestValet,
  requestValetReturn,
  requestWash,
  type WashRequestBody,
} from '../api/addons';
import type { CheckoutResult } from '../checkout-html';

export const ADDONS_KEY = ['driver', 'addons'] as const;
const VALET_JOB_KEY = ['driver', 'valet-job'] as const;
const WASH_JOB_KEY = ['driver', 'wash-job'] as const;

/**
 * How often a live job is re-read. A valet or a wash partner moves the job on
 * from their own phone and nothing tells this one, so the screen asks. Slow
 * enough to be cheap, quick enough that "Valet arrived" is not a minute late.
 */
export const ADDON_POLL_MS = 10_000;

/**
 * A booking's add-on jobs: the server's list merged with this device's record (`addon-store.ts`).
 * When the server cannot be reached the device's record stands in, so the screen still shows
 * the valet the driver asked for.
 */
export function useBookingAddons(bookingId: string | undefined) {
  return useQuery({
    queryKey: [...ADDONS_KEY, bookingId],
    enabled: bookingId !== undefined,
    queryFn: async ({ signal }) => {
      if (bookingId === undefined) throw new Error('Add-ons requested with no booking');
      const local = await readBookingAddons(bookingId);
      try {
        return mergeAddons(await fetchBookingAddons(bookingId, signal), local);
      } catch (error) {
        if (signal.aborted) throw error;
        warn("driver.addons: server list unavailable, showing this device's record", error);
        return local;
      }
    },
  });
}

export function useValetJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: [...VALET_JOB_KEY, jobId],
    enabled: typeof jobId === 'string',
    queryFn: ({ signal }) => {
      if (typeof jobId !== 'string') throw new Error('Valet job requested with no id');
      return fetchValetJob(jobId, signal);
    },
    staleTime: 0,
    refetchInterval: (query) => {
      const job = query.state.data;
      return job !== undefined && valetIsLive(job) ? ADDON_POLL_MS : false;
    },
  });
}

export function useWashJob(jobId: string | undefined) {
  return useQuery({
    queryKey: [...WASH_JOB_KEY, jobId],
    enabled: jobId !== undefined,
    queryFn: ({ signal }) => {
      if (jobId === undefined) throw new Error('Wash job requested with no id');
      return fetchWashJob(jobId, signal);
    },
    staleTime: 0,
    refetchInterval: (query) => {
      const job = query.state.data;
      return job !== undefined && washIsLive(job) ? ADDON_POLL_MS : false;
    },
  });
}

function useAddonWrites() {
  const client = useQueryClient();
  return {
    valet: (job: DriverValetJob) => {
      client.setQueryData([...VALET_JOB_KEY, job.id], job);
    },
    wash: (job: DriverWashJob) => {
      client.setQueryData([...WASH_JOB_KEY, job.id], job);
    },
    addons: (bookingId: string, addons: BookingAddons) => {
      client.setQueryData([...ADDONS_KEY, bookingId], addons);
    },
  };
}

/**
 * One intent per request screen, held by the shared `useIntent` (R-FE-05): a
 * "try again" after a timeout is the same request, so the server answers the
 * job it already made rather than dispatching a second valet. Reset on success,
 * so a later request on the same screen is a new one.
 */
export function useRequestValet(bookingId: string) {
  const writes = useAddonWrites();
  const intent = useIntent();

  return useMutation({
    mutationFn: (pickup: MeetingPoint) => requestValet(bookingId, pickup, intent),
    onSuccess: async (job) => {
      intent.reset();
      writes.valet(job);
      writes.addons(bookingId, await rememberValetJob(bookingId, job.id));
    },
  });
}

export function useRequestValetReturn(jobId: string) {
  const writes = useAddonWrites();
  const intent = useIntent();

  return useMutation({
    mutationFn: (drop: MeetingPoint) => requestValetReturn(jobId, drop, intent),
    onSuccess: (job) => {
      intent.reset();
      writes.valet(job);
    },
  });
}

export function useCancelValet(jobId: string) {
  const writes = useAddonWrites();
  const intent = useIntent();

  return useMutation({
    mutationFn: () => cancelValet(jobId, intent),
    onSuccess: (job) => {
      intent.reset();
      writes.valet(job);
    },
  });
}

export function useRequestWash() {
  const writes = useAddonWrites();
  const intent = useIntent();

  return useMutation({
    mutationFn: (body: WashRequestBody) => requestWash(body, intent),
    onSuccess: async (job) => {
      intent.reset();
      writes.wash(job);
      writes.addons(job.bookingId, await rememberWashJob(job.bookingId, job.id));
    },
  });
}

export function useCancelWash(jobId: string) {
  const writes = useAddonWrites();
  const intent = useIntent();

  return useMutation({
    mutationFn: () => cancelWash(jobId, intent),
    onSuccess: (job) => {
      intent.reset();
      writes.wash(job);
    },
  });
}

export type WashCheckoutPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'creating-order' }
  | { readonly phase: 'checkout'; readonly order: WashPaymentOrder }
  | { readonly phase: 'failed'; readonly message: string }
  | { readonly phase: 'paid' };

/**
 * Paying for a wash, from the Pay tap to Checkout's answer.
 *
 * There is no verify call after Checkout. The booking flow's
 * `POST /driver/payments/verify` refuses a wash payment by design (§13.4 gives a
 * wash its own order route), so the webhook alone captures it. What this hook
 * can honestly say on success is "paid, confirming": it records the job as paid
 * on this device so the button does not invite a second payment, and the
 * server's capture lands without the driver waiting on it.
 */
export function useWashCheckout(job: DriverWashJob | undefined) {
  const writes = useAddonWrites();
  const intent = useIntent();
  const [state, setState] = useState<WashCheckoutPhase>({ phase: 'idle' });

  const orderMutation = useMutation({
    mutationFn: (jobId: string) => createWashOrder(jobId, intent),
  });

  const start = useCallback(() => {
    if (job === undefined) return;
    setState({ phase: 'creating-order' });
    orderMutation.mutate(job.id, {
      onSuccess: (order) => {
        setState({ phase: 'checkout', order });
      },
      onError: (error: unknown) => {
        // The server's own copy: WASH_NOT_PAYABLE says nobody has taken the
        // job yet, which is a different next step from a dropped connection.
        setState({ phase: 'failed', message: toApiFailure(error).message });
      },
    });
  }, [job, orderMutation]);

  const handleResult = useCallback(
    (result: CheckoutResult) => {
      if (job === undefined) return;
      if (result.type === 'dismissed') {
        setState({ phase: 'idle' });
        return;
      }
      if (result.type === 'failed') {
        setState({
          phase: 'failed',
          message: 'The payment did not go through. Nothing was charged. Try again.',
        });
        return;
      }
      // The order intent is spent; a later order on this screen is a new one.
      intent.reset();
      setState({ phase: 'paid' });
      void rememberWashPaid(job.bookingId, job.id).then((addons) => {
        writes.addons(job.bookingId, addons);
      });
    },
    [intent, job, writes],
  );

  return { state, start, handleResult };
}
