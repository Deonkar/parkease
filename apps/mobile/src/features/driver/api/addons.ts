import {
  type DriverBookingAddons,
  driverBookingAddonsSchema,
  type DriverValetJob,
  driverValetJobSchema,
  type DriverWashJob,
  driverWashJobSchema,
  type WashPaymentOrder,
  washPaymentOrderSchema,
} from '@parkease/contracts/driver';
import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

/**
 * The driver's add-ons to a booking: a valet (§11.10) and a car wash (§13.5).
 *
 * Every response is parsed, never asserted (R-VAL-01). No body here names a
 * price: a wash is priced by whichever partner wins the offer race, and a valet
 * leg by the distance the server measures, so the client sends what the driver
 * wants and reads back what it costs (R-FE-06).
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

/** Where the valet meets the driver, or brings the car back to. */
export interface MeetingPoint {
  readonly lat: number;
  readonly lng: number;
  readonly address: string;
}

/** The valet and wash jobs the server holds for one of the driver's bookings (S-148). */
export async function fetchBookingAddons(
  bookingId: string,
  signal?: AbortSignal,
): Promise<DriverBookingAddons> {
  const response = await api.get<unknown>(`/driver/bookings/${bookingId}/addons`, { signal });
  return envelope(driverBookingAddonsSchema).parse(response.data).data;
}

export async function requestValet(
  bookingId: string,
  pickup: MeetingPoint,
  intent: Intent,
): Promise<DriverValetJob> {
  const response = await api.post<unknown>(
    '/driver/valet/requests',
    { bookingId, pickup },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverValetJobSchema).parse(response.data).data;
}

export async function fetchValetJob(id: string, signal?: AbortSignal): Promise<DriverValetJob> {
  const response = await api.get<unknown>(`/driver/valet/requests/${id}`, { signal });
  return envelope(driverValetJobSchema).parse(response.data).data;
}

export async function requestValetReturn(
  id: string,
  dropLocation: MeetingPoint,
  intent: Intent,
): Promise<DriverValetJob> {
  const response = await api.post<unknown>(
    `/driver/valet/requests/${id}/return`,
    { dropLocation },
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverValetJobSchema).parse(response.data).data;
}

export async function cancelValet(id: string, intent: Intent): Promise<DriverValetJob> {
  const response = await api.post<unknown>(
    `/driver/valet/requests/${id}/cancel`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverValetJobSchema).parse(response.data).data;
}

export interface WashRequestBody {
  readonly bookingId: string;
  readonly serviceName: CarwashServiceName;
  readonly vehicleType: VehicleType;
}

export async function requestWash(body: WashRequestBody, intent: Intent): Promise<DriverWashJob> {
  const response = await api.post<unknown>('/driver/carwash/requests', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
  return envelope(driverWashJobSchema).parse(response.data).data;
}

export async function fetchWashJob(id: string, signal?: AbortSignal): Promise<DriverWashJob> {
  const response = await api.get<unknown>(`/driver/carwash/requests/${id}`, { signal });
  return envelope(driverWashJobSchema).parse(response.data).data;
}

/**
 * The Checkout handoff for a wash. The server answers the order it already has
 * for this job when one is open, so a reopened Checkout is the same order.
 */
export async function createWashOrder(id: string, intent: Intent): Promise<WashPaymentOrder> {
  const response = await api.post<unknown>(
    `/driver/carwash/requests/${id}/order`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washPaymentOrderSchema).parse(response.data).data;
}

export async function cancelWash(id: string, intent: Intent): Promise<DriverWashJob> {
  const response = await api.post<unknown>(
    `/driver/carwash/requests/${id}/cancel`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(driverWashJobSchema).parse(response.data).data;
}
