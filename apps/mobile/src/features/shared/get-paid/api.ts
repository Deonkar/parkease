import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import {
  type BankDetailsView,
  bankDetailsViewSchema,
  type PayoutSummaryView,
  payoutSummaryViewSchema,
  payoutViewSchema,
  type RouteOnboardingView,
  routeOnboardingViewSchema,
  type SubmitRouteOnboarding,
  type UpdateBankDetails,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

import { toApiFailure } from '../api/errors';
import { isSharedDevMock } from '../dev-mock';

import { devGetPaid } from './dev-fixtures';

/**
 * The Get paid endpoints (tasks 16a/16b). Every response is parsed, never asserted
 * (R-VAL-01). The server's own "not yet" 404 on the two "have I set this up?" reads is an
 * answer and becomes `null`, matched by code: a bare 404 from a wrong base URL or a missing
 * route is a failure, thrown for the screen's error state like every other.
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
const payoutPageSchema = z.object({ data: z.array(payoutViewSchema), meta: cursorPageMetaSchema });

const isDevMock = (): Promise<boolean> => isSharedDevMock('getPaid.isDevMock');

async function orNullWhenNone<T>(code: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    const failure = toApiFailure(error);
    if (failure.status === 404 && failure.code === code) return null;
    throw error;
  }
}

const withKey = (intent: Intent) => ({ headers: { 'Idempotency-Key': intent.idempotencyKey } });

export async function fetchRouteOnboarding(signal?: AbortSignal) {
  if (await isDevMock()) return devGetPaid.route();
  return orNullWhenNone('ROUTE_ONBOARDING_NOT_FOUND', async () => {
    const response = await api.get<unknown>('/me/route-onboarding', { signal });
    return envelope(routeOnboardingViewSchema).parse(response.data).data;
  });
}

export async function submitRouteOnboarding(
  form: SubmitRouteOnboarding,
  intent: Intent,
): Promise<RouteOnboardingView> {
  if (await isDevMock()) return devGetPaid.submitRoute(form);
  const response = await api.put<unknown>('/me/route-onboarding', form, withKey(intent));
  return envelope(routeOnboardingViewSchema).parse(response.data).data;
}

export async function fetchPayoutSummary(signal?: AbortSignal): Promise<PayoutSummaryView> {
  if (await isDevMock()) return devGetPaid.summary();
  const response = await api.get<unknown>('/me/payouts/summary', { signal });
  return envelope(payoutSummaryViewSchema).parse(response.data).data;
}

export async function fetchPayouts(cursor: string | undefined, signal?: AbortSignal) {
  if (await isDevMock()) return devGetPaid.payouts(cursor);
  const response = await api.get<unknown>('/me/payouts', {
    params: { limit: 20, ...(cursor === undefined ? {} : { cursor }) },
    signal,
  });
  return payoutPageSchema.parse(response.data);
}

export async function fetchBankDetails(signal?: AbortSignal) {
  if (await isDevMock()) return devGetPaid.bank();
  return orNullWhenNone('BANK_DETAILS_NOT_FOUND', async () => {
    const response = await api.get<unknown>('/me/bank-details', { signal });
    return envelope(bankDetailsViewSchema).parse(response.data).data;
  });
}

export async function saveBankDetails(
  form: UpdateBankDetails,
  intent: Intent,
): Promise<BankDetailsView> {
  if (await isDevMock()) return devGetPaid.saveBank(form);
  const response = await api.put<unknown>('/me/bank-details', form, withKey(intent));
  return envelope(bankDetailsViewSchema).parse(response.data).data;
}
