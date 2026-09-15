import {
  driverBookingSchema,
  type QuoteResult,
  quoteResultSchema,
  spaceDetailSchema,
  type DriverBooking,
  type SpaceDetail,
} from '@parkease/contracts/driver';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

/**
 * Every response is parsed, never asserted. A payload from the network is data
 * from outside the process and goes through Zod like any other boundary
 * (R-VAL-01) — including the price, which the client displays and never
 * recomputes (R-FE-06).
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

const bookingsPageSchema = z.object({
  data: z.object({
    items: z.array(driverBookingSchema),
    meta: z.object({
      limit: z.number().int(),
      hasMore: z.boolean(),
      nextCursor: z.string().nullable(),
    }),
  }),
});

export type BookingsPage = z.infer<typeof bookingsPageSchema>['data'];

export async function fetchSpaceDetail(
  spaceId: string,
  signal?: AbortSignal,
): Promise<SpaceDetail> {
  const response = await api.get<unknown>(`/driver/spaces/${spaceId}`, { signal });
  return envelope(spaceDetailSchema).parse(response.data).data;
}

export interface QuoteParams {
  readonly spaceId: string;
  readonly vehicleType: string;
  readonly durationType: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Prices a window without reserving it, so Review & Pay can show the
 * breakdown before the driver commits to anything. */
export async function fetchQuote(params: QuoteParams, signal?: AbortSignal): Promise<QuoteResult> {
  const response = await api.get<unknown>('/driver/quotes', { params, signal });
  return envelope(quoteResultSchema).parse(response.data).data;
}

export interface CreateBookingBody {
  readonly spaceId: string;
  readonly vehicleType: 'car' | 'two_wheeler';
  readonly durationType: 'hourly' | 'daily' | 'weekly' | 'monthly';
  readonly startsAt: string;
  readonly endsAt: string;
  readonly vehicleNumber?: string;
}

/**
 * The intent is minted when the driver taps the button, not per HTTP attempt,
 * and reused across every retry (R-FE-05, ADR-011). On a booking that is what
 * stops a flaky connection producing two reservations.
 */
export async function createBooking(
  body: CreateBookingBody,
  intent: Intent,
): Promise<DriverBooking> {
  const response = await api.post<unknown>('/driver/bookings', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
  return envelope(driverBookingSchema).parse(response.data).data;
}

export interface ListBookingsParams {
  readonly filter: 'all' | 'upcoming' | 'past';
  readonly cursor?: string;
  readonly limit?: number;
}

export async function listBookings(
  params: ListBookingsParams,
  signal?: AbortSignal,
): Promise<BookingsPage> {
  const response = await api.get<unknown>('/driver/bookings', { params, signal });
  return bookingsPageSchema.parse(response.data).data;
}

export async function fetchBooking(id: string, signal?: AbortSignal): Promise<DriverBooking> {
  const response = await api.get<unknown>(`/driver/bookings/${id}`, { signal });
  return envelope(driverBookingSchema).parse(response.data).data;
}

export async function cancelBooking(
  id: string,
  reason: string | undefined,
  intent: Intent,
): Promise<DriverBooking> {
  const response = await api.post<unknown>(
    `/driver/bookings/${id}/cancel`,
    reason === undefined ? {} : { reason },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverBookingSchema).parse(response.data).data;
}

export async function extendBooking(
  id: string,
  newEndsAt: string,
  intent: Intent,
): Promise<DriverBooking> {
  const response = await api.post<unknown>(
    `/driver/bookings/${id}/extend`,
    { newEndsAt },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverBookingSchema).parse(response.data).data;
}

/** The unattended-space fallback. No token: the server gates it on time. */
export async function selfCheckIn(id: string, intent: Intent): Promise<DriverBooking> {
  const response = await api.post<unknown>(
    `/driver/bookings/${id}/check-in`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverBookingSchema).parse(response.data).data;
}
