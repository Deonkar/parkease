import {
  type CreateReview,
  type PendingReview,
  pendingReviewSchema,
  type PublicReviewView,
  publicReviewViewSchema,
  type ReportReview,
  type ReviewView,
  reviewViewSchema,
} from '@parkease/contracts/driver';
import {
  type OwnerSpaceReviewSummary,
  ownerSpaceReviewSummarySchema,
} from '@parkease/contracts/owner';
import { type CursorPageMeta, cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { api, type Intent } from '@/lib/api';

import { isSharedDevMock } from '../dev-mock';

import { devReviews } from './dev-fixtures';

/**
 * Reviews, for the driver and the owner (task 17b). Every response is parsed, never asserted
 * (R-VAL-01); every write carries the caller's intent key (R-FE-05). In a dev-mock session the
 * fixtures answer instead of the network, so the screens open in the web preview.
 */
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), meta: cursorPageMetaSchema });

export interface Page<T> {
  readonly data: T[];
  readonly meta: CursorPageMeta;
}

const isDevMock = (): Promise<boolean> => isSharedDevMock('reviews.isDevMock');
const withKey = (intent: Intent) => ({ headers: { 'Idempotency-Key': intent.idempotencyKey } });

export async function fetchPendingReviews(signal?: AbortSignal): Promise<PendingReview[]> {
  if (await isDevMock()) return devReviews.pending();
  const response = await api.get<unknown>('/driver/reviews/pending', { signal });
  return envelope(z.array(pendingReviewSchema)).parse(response.data).data;
}

export async function createReview(body: CreateReview, intent: Intent): Promise<ReviewView> {
  if (await isDevMock()) return devReviews.create(body);
  const response = await api.post<unknown>('/driver/reviews', body, withKey(intent));
  return envelope(reviewViewSchema).parse(response.data).data;
}

export async function fetchSpaceReviews(
  spaceId: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<Page<PublicReviewView>> {
  if (await isDevMock()) return devReviews.spacePage(cursor);
  const response = await api.get<unknown>(`/driver/spaces/${spaceId}/reviews`, {
    params: cursor === undefined ? {} : { cursor },
    signal,
  });
  return pageOf(publicReviewViewSchema).parse(response.data);
}

/** Drivers report from a space; owners from their own listing. Same body, two routes. */
export async function reportReview(
  as: 'driver' | 'owner',
  reviewId: string,
  body: ReportReview,
  intent: Intent,
): Promise<void> {
  if (await isDevMock()) return;
  await api.post<unknown>(`/${as}/reviews/${reviewId}/report`, body, withKey(intent));
}

export async function fetchOwnerReviews(
  spaceId: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<Page<ReviewView>> {
  if (await isDevMock()) return devReviews.ownerPage(cursor);
  const response = await api.get<unknown>('/owner/reviews', {
    params: cursor === undefined ? { spaceId } : { spaceId, cursor },
    signal,
  });
  return pageOf(reviewViewSchema).parse(response.data);
}

export async function fetchOwnerReviewSummary(
  signal?: AbortSignal,
): Promise<OwnerSpaceReviewSummary[]> {
  if (await isDevMock()) return devReviews.ownerSummary();
  const response = await api.get<unknown>('/owner/reviews/summary', { signal });
  return envelope(z.array(ownerSpaceReviewSummarySchema)).parse(response.data).data;
}

export async function respondToReview(
  reviewId: string,
  response: string,
  intent: Intent,
): Promise<ReviewView> {
  if (await isDevMock()) return devReviews.respond(reviewId, response);
  const reply = await api.post<unknown>(
    `/owner/reviews/${reviewId}/respond`,
    { response },
    withKey(intent),
  );
  return envelope(reviewViewSchema).parse(reply.data).data;
}
