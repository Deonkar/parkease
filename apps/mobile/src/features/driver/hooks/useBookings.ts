import type { DriverBooking } from '@parkease/contracts/driver';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { newIntent, type Intent } from '@/lib/api';

import {
  cancelBooking,
  createBooking,
  extendBooking,
  fetchBooking,
  fetchQuote,
  fetchSpaceDetail,
  listBookings,
  type QuoteParams,
  selfCheckIn,
  type BookingsPage,
  type CreateBookingBody,
  type ListBookingsParams,
} from '../api/bookings';

export const BOOKINGS_KEY = ['driver', 'bookings'] as const;
export const SPACE_DETAIL_KEY = ['driver', 'space'] as const;

export function useSpaceDetail(spaceId: string | undefined) {
  return useQuery({
    queryKey: [...SPACE_DETAIL_KEY, spaceId],
    enabled: spaceId !== undefined,
    queryFn: ({ signal }) => {
      if (spaceId === undefined) throw new Error('Space detail requested with no id');
      return fetchSpaceDetail(spaceId, signal);
    },
    // The free-slot counts on this screen are what the driver books against.
    // Never cached (ADR-010) — the 30s default would sell a taken slot.
    staleTime: 0,
  });
}

/**
 * Prices a window for Review & Pay. Reserves nothing, so the driver can look at
 * the breakdown and walk away without taking a slot off the market.
 *
 * Never cached: the surge multiplier can move between two visits to this screen,
 * and a stale quote is a number the create call will not honour.
 */
export function useQuote(params: QuoteParams | null) {
  return useQuery({
    queryKey: ['driver', 'quote', params],
    enabled: params !== null,
    queryFn: ({ signal }) => {
      if (params === null) throw new Error('Quote requested with no window');
      return fetchQuote(params, signal);
    },
    staleTime: 0,
    retry: false,
  });
}

export function useBookingsList(filter: ListBookingsParams['filter']) {
  return useInfiniteQuery({
    queryKey: [...BOOKINGS_KEY, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<BookingsPage> =>
      listBookings(pageParam === undefined ? { filter } : { filter, cursor: pageParam }, signal),
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

export function useBooking(bookingId: string | undefined) {
  return useQuery({
    queryKey: [...BOOKINGS_KEY, 'detail', bookingId],
    enabled: bookingId !== undefined,
    queryFn: ({ signal }) => {
      if (bookingId === undefined) throw new Error('Booking requested with no id');
      return fetchBooking(bookingId, signal);
    },
    // The QR token and the status both change without the app asking — an owner
    // can scan at any moment — so this one stays fresh.
    staleTime: 0,
  });
}

/**
 * Invalidating the list and the space together after any write.
 *
 * The space matters as much as the list: cancelling a booking frees a slot, and
 * a driver who backs out to the space they just released should see it free.
 */
function useBookingInvalidation() {
  const client = useQueryClient();
  return (booking: DriverBooking) => {
    void client.invalidateQueries({ queryKey: BOOKINGS_KEY });
    void client.invalidateQueries({ queryKey: [...SPACE_DETAIL_KEY, booking.space.id] });
    client.setQueryData([...BOOKINGS_KEY, 'detail', booking.id], booking);
  };
}

/**
 * One intent for the life of the component (R-FE-05).
 *
 * A `useRef`, not a bare call in the hook body. `newIntent()` in the body runs
 * on *every render* — and `useMutation` re-renders the component itself as
 * `isPending` flips — so the key would change between the attempt that timed out
 * and the "try again" that follows it. The server would then see two distinct
 * intents and reserve two slots, which is the exact double-booking the rule
 * exists to prevent.
 *
 * Deliberately not regenerated on error: "try again" on the same screen is the
 * same intent. A genuinely new attempt means a new screen, and a new screen
 * means a new component.
 */
function useIntent(): Intent {
  const intent = useRef<Intent | null>(null);
  intent.current ??= newIntent();
  return intent.current;
}

export function useCreateBooking() {
  const invalidate = useBookingInvalidation();
  const intent = useIntent();

  return useMutation({
    mutationFn: (body: CreateBookingBody) => createBooking(body, intent),
    onSuccess: invalidate,
  });
}

export function useCancelBooking(bookingId: string) {
  const invalidate = useBookingInvalidation();
  const intent = useIntent();

  return useMutation({
    mutationFn: (reason?: string) => cancelBooking(bookingId, reason, intent),
    onSuccess: invalidate,
  });
}

export function useExtendBooking(bookingId: string) {
  const invalidate = useBookingInvalidation();
  const intent = useIntent();

  return useMutation({
    mutationFn: (newEndsAt: string) => extendBooking(bookingId, newEndsAt, intent),
    onSuccess: invalidate,
  });
}

export function useSelfCheckIn(bookingId: string) {
  const invalidate = useBookingInvalidation();
  const intent = useIntent();

  return useMutation({
    mutationFn: () => selfCheckIn(bookingId, intent),
    onSuccess: invalidate,
  });
}
