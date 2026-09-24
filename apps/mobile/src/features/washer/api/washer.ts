import { type CarwashJobEvent, type CarwashServiceName } from '@parkease/contracts/enums';
import {
  acceptWashJobSchema,
  advanceWashJobSchema,
  attachWashPhotoSchema,
  createWasherProfileSchema,
  setWasherAvailabilitySchema,
  submitWasherDocumentsSchema,
  type CreateWasherProfile,
  type SubmitWasherDocuments,
  type UpsertWashService,
  type WashJobOffer,
  type WashJobView,
  type WashServiceMenu,
  type WasherEarningsPeriod,
  type WasherEarningsView,
  type WasherProfileView,
  upsertWashServiceSchema,
  washJobOfferSchema,
  washJobViewSchema,
  washerEarningsViewSchema,
  washerProfileViewSchema,
  washServiceMenuSchema,
} from '@parkease/contracts/washer';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

import { isWasherDevMock } from '../dev-mock';

import { washerDevStore } from './dev-fixtures';

/**
 * Every washer call goes through `lib/api.ts` (R-FE-03), which inherits auth,
 * single-flight refresh and the retry policy.
 *
 * Every response is parsed, never asserted (R-VAL-01). Money fields are read
 * and displayed; nothing here computes one (R-FE-06).
 *
 * Under a dev-mock session — `__DEV__` only, never a release build — each call
 * is answered by the in-memory store in `dev-fixtures.ts` instead of the
 * network, so the screens above stay exactly as they are (ruling T11-W1).
 * Registration and document upload are not served: the fixture partner is
 * already verified.
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

export async function fetchOffers(signal?: AbortSignal): Promise<WashJobOffer[]> {
  if (await isWasherDevMock()) return washerDevStore().offers();
  const response = await api.get<unknown>('/washer/jobs/offers', { signal });
  return envelope(z.array(washJobOfferSchema)).parse(response.data).data;
}

export async function fetchActiveJob(signal?: AbortSignal): Promise<WashJobView | null> {
  if (await isWasherDevMock()) return washerDevStore().active();
  const response = await api.get<unknown>('/washer/jobs/active', { signal });
  return envelope(washJobViewSchema.nullable()).parse(response.data).data;
}

export async function fetchEarnings(
  period: WasherEarningsPeriod,
  signal?: AbortSignal,
): Promise<WasherEarningsView> {
  if (await isWasherDevMock()) return washerDevStore().earnings(period);
  const response = await api.get<unknown>('/washer/earnings', { params: { period }, signal });
  return envelope(washerEarningsViewSchema).parse(response.data).data;
}

export async function fetchMenu(signal?: AbortSignal): Promise<WashServiceMenu> {
  if (await isWasherDevMock()) return washerDevStore().menu();
  const response = await api.get<unknown>('/washer/services', { signal });
  return envelope(washServiceMenuSchema).parse(response.data).data;
}

export async function fetchProfile(signal?: AbortSignal): Promise<WasherProfileView> {
  if (await isWasherDevMock()) return washerDevStore().profile();
  const response = await api.get<unknown>('/washer/profile', { signal });
  return envelope(washerProfileViewSchema).parse(response.data).data;
}

export async function acceptOffer(jobId: string, intent: Intent): Promise<WashJobView> {
  if (await isWasherDevMock()) return washerDevStore().accept(jobId);
  const response = await api.post<unknown>(
    `/washer/jobs/${jobId}/accept`,
    // Through the contract, even empty (J3): a field added to it later is a
    // parse here, not a body the server no longer accepts.
    acceptWashJobSchema.parse({}),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washJobViewSchema).parse(response.data).data;
}

export async function advanceJob(
  jobId: string,
  event: CarwashJobEvent,
  intent: Intent,
): Promise<WashJobView> {
  if (await isWasherDevMock()) return washerDevStore().advance(jobId, event);
  const response = await api.post<unknown>(
    `/washer/jobs/${jobId}/status`,
    advanceWashJobSchema.parse({ event }),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washJobViewSchema).parse(response.data).data;
}

/**
 * Two routes, not one with a slot parameter — §13.8. The body is built through
 * the contract, never hand-assembled: a request body is a contract consumer
 * too, and the valet proof upload is what happens when it is not
 * (`learnings.md`).
 */
export async function attachPhoto(
  jobId: string,
  slot: 'before' | 'after',
  photoId: string,
  intent: Intent,
): Promise<WashJobView> {
  if (await isWasherDevMock()) return washerDevStore().attach(jobId, slot, photoId);
  const response = await api.post<unknown>(
    `/washer/jobs/${jobId}/${slot}-photo`,
    attachWashPhotoSchema.parse({ photoId }),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washJobViewSchema).parse(response.data).data;
}

export async function setAvailability(
  isOnline: boolean,
  intent: Intent,
  fix?: { lat: number; lng: number },
): Promise<void> {
  // Refuses `isOnline: true` without a location — a partner with no position
  // cannot be matched, so the server will not let one into the pool.
  const body = setWasherAvailabilitySchema.parse({
    isOnline,
    ...(fix === undefined ? {} : { location: { lat: fix.lat, lng: fix.lng } }),
  });

  if (await isWasherDevMock()) {
    washerDevStore().setOnline(body.isOnline);
    return;
  }

  await api.patch('/washer/availability', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
}

export async function upsertService(
  serviceName: CarwashServiceName,
  input: UpsertWashService,
  intent: Intent,
): Promise<WashServiceMenu> {
  if (await isWasherDevMock()) {
    return washerDevStore().upsert(serviceName, upsertWashServiceSchema.parse(input));
  }
  const response = await api.put<unknown>(
    `/washer/services/${serviceName}`,
    upsertWashServiceSchema.parse(input),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washServiceMenuSchema).parse(response.data).data;
}

export async function createProfile(
  input: CreateWasherProfile,
  intent: Intent,
): Promise<WasherProfileView> {
  const response = await api.post<unknown>(
    '/washer/profile',
    createWasherProfileSchema.parse(input),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washerProfileViewSchema).parse(response.data).data;
}

export async function submitDocuments(
  input: SubmitWasherDocuments,
  intent: Intent,
): Promise<WasherProfileView> {
  const response = await api.post<unknown>(
    '/washer/profile/documents',
    submitWasherDocumentsSchema.parse(input),
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return envelope(washerProfileViewSchema).parse(response.data).data;
}
