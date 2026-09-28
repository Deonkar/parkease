import {
  type OwnerBooking,
  type OwnerBookingGroup,
  type OwnerDashboard,
  type OwnerEarningsPeriod,
  type OwnerEarningsView,
  ownerBookingSchema,
  ownerDashboardSchema,
  ownerEarningsViewSchema,
  statementLineSchema,
} from '@parkease/contracts/owner';
import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { api } from '@/lib/api';

/**
 * Every response is parsed, never asserted. A payload from the network is
 * data from outside the process and goes through Zod like any other boundary
 * (R-VAL-01).
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
const transactionsPageSchema = z.object({
  data: z.array(statementLineSchema),
  meta: cursorPageMetaSchema,
});

export async function fetchDashboard(signal?: AbortSignal): Promise<OwnerDashboard> {
  const response = await api.get<unknown>('/owner/dashboard', { signal });
  return envelope(ownerDashboardSchema).parse(response.data).data;
}

export async function fetchEarnings(
  period: OwnerEarningsPeriod,
  signal?: AbortSignal,
): Promise<OwnerEarningsView> {
  const response = await api.get<unknown>('/owner/earnings', { params: { period }, signal });
  return envelope(ownerEarningsViewSchema).parse(response.data).data;
}

export async function fetchTransactions(
  period: OwnerEarningsPeriod,
  cursor: string | undefined,
  signal?: AbortSignal,
) {
  const response = await api.get<unknown>('/owner/earnings/transactions', {
    params: { period, ...(cursor === undefined ? {} : { cursor }) },
    signal,
  });
  return transactionsPageSchema.parse(response.data);
}

export async function fetchSpaceBookings(
  spaceId: string,
  group: OwnerBookingGroup,
  signal?: AbortSignal,
): Promise<OwnerBooking[]> {
  const response = await api.get<unknown>(`/owner/spaces/${spaceId}/bookings`, {
    params: { group },
    signal,
  });
  return envelope(z.array(ownerBookingSchema)).parse(response.data).data;
}
