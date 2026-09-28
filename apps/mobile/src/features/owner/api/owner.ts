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
import { type CursorPageMeta, cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { api } from '@/lib/api';
import { listDevMockSpaces } from '@/lib/dev-mock-store';

import { isOwnerDevMock } from '../dev-mock';

import { devDashboard, devEarnings, devSpaceBookings, devTransactions } from './dev-fixtures';

/**
 * Every response is parsed, never asserted. A payload from the network is
 * data from outside the process and goes through Zod like any other boundary
 * (R-VAL-01).
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
const cursorPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), meta: cursorPageMetaSchema });
const transactionsPageSchema = cursorPage(statementLineSchema);
const spaceBookingsPageSchema = cursorPage(ownerBookingSchema);

export async function fetchDashboard(signal?: AbortSignal): Promise<OwnerDashboard> {
  if (await isOwnerDevMock()) {
    return devDashboard(listDevMockSpaces());
  }
  const response = await api.get<unknown>('/owner/dashboard', { signal });
  return envelope(ownerDashboardSchema).parse(response.data).data;
}

export async function fetchEarnings(
  period: OwnerEarningsPeriod,
  signal?: AbortSignal,
): Promise<OwnerEarningsView> {
  if (await isOwnerDevMock()) {
    return devEarnings(period);
  }
  const response = await api.get<unknown>('/owner/earnings', { params: { period }, signal });
  return envelope(ownerEarningsViewSchema).parse(response.data).data;
}

export async function fetchTransactions(
  period: OwnerEarningsPeriod,
  cursor: string | undefined,
  signal?: AbortSignal,
) {
  if (await isOwnerDevMock()) {
    return devTransactions(period, cursor);
  }
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
): Promise<{ data: OwnerBooking[]; meta: CursorPageMeta }> {
  if (await isOwnerDevMock()) {
    return devSpaceBookings(spaceId, group);
  }
  const response = await api.get<unknown>(`/owner/spaces/${spaceId}/bookings`, {
    params: { group },
    signal,
  });
  return spaceBookingsPageSchema.parse(response.data);
}
