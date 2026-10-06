import type { ReportReview } from '@parkease/contracts/driver';
import type { BookingId } from '@parkease/contracts/primitives';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';

import {
  createReview,
  fetchOwnerReviews,
  fetchOwnerReviewSummary,
  fetchPendingReviews,
  fetchSpaceReviews,
  reportReview,
  respondToReview,
} from './api';
import { settleSubmissions, type SheetRow, type SubmitResult } from './sheet-state';

/**
 * Space detail's query root. Defined here, and imported by the driver's booking hooks, because a
 * review changes what space detail shows and `features/shared` may not import a role folder.
 */
export const SPACE_DETAIL_KEY = ['driver', 'space'] as const;

const REVIEWS_KEY = ['reviews'] as const;
const PENDING_KEY = [...REVIEWS_KEY, 'pending'] as const;
const OWNER_KEY = [...REVIEWS_KEY, 'owner'] as const;

export function usePendingReviews() {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: ({ signal }) => fetchPendingReviews(signal),
  });
}

export function useSpaceReviews(spaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...REVIEWS_KEY, 'space', spaceId],
    enabled: spaceId !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (spaceId === undefined) throw new Error('Space reviews requested with no id');
      return fetchSpaceReviews(spaceId, pageParam, signal);
    },
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
}

/**
 * One intent per (target, body), kept for the component's life (R-FE-05). Retrying the same
 * review reuses its key, so if the first attempt landed the server replays it. Changing the stars
 * or the words is a new intent: the server refuses a reused key with a different body (422), so
 * reusing it there would turn an edit into a permanent failure.
 */
function useRowIntents() {
  const intents = useRef(new Map<string, Intent>());
  return (targetId: string, body: unknown): Intent => {
    const key = `${targetId}:${JSON.stringify(body)}`;
    let intent = intents.current.get(key);
    if (intent === undefined) {
      intent = newIntent();
      intents.current.set(key, intent);
    }
    return intent;
  };
}

export type { SubmitResult } from './sheet-state';

/**
 * Saves each rated row on its own. One failing does not roll back the others (§17.11): the sheet
 * reopens with only what did not save. Rows the driver left unrated are not sent.
 */
/** `spaceId` is undefined when the space was already reviewed: nothing on it to refresh. */
export function useSubmitReviews(bookingId: BookingId, spaceId: string | undefined) {
  const client = useQueryClient();
  const intentFor = useRowIntents();
  return useMutation({
    mutationFn: async (rows: readonly SheetRow[]): Promise<SubmitResult> => {
      const rated = rows.flatMap((row) =>
        row.rating === null ? [] : [{ ...row, rating: row.rating }],
      );
      const results = await Promise.allSettled(
        rated.map((row) => {
          const body = {
            bookingId,
            targetType: row.targetType,
            targetId: row.targetId,
            rating: row.rating,
            ...(row.comment.trim() === '' ? {} : { comment: row.comment }),
          };
          return createReview(body, intentFor(row.targetId, body));
        }),
      );
      const settled = settleSubmissions(rated, results);
      for (const failure of settled.failures) {
        warn('reviews.submit: a rating did not save', failure);
      }
      return settled;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: PENDING_KEY });
      if (spaceId === undefined) return;
      void client.invalidateQueries({ queryKey: [...SPACE_DETAIL_KEY, spaceId] });
      void client.invalidateQueries({ queryKey: [...REVIEWS_KEY, 'space', spaceId] });
    },
  });
}

export function useReportReview(as: 'driver' | 'owner') {
  const client = useQueryClient();
  const intentFor = useRowIntents();
  return useMutation({
    mutationFn: ({ reviewId, body }: { reviewId: string; body: ReportReview }) =>
      reportReview(as, reviewId, body, intentFor(reviewId, body)),
    onSuccess: () => {
      if (as === 'owner') void client.invalidateQueries({ queryKey: OWNER_KEY });
    },
  });
}

export function useOwnerReviews(spaceId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...OWNER_KEY, 'list', spaceId],
    enabled: spaceId !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (spaceId === undefined) throw new Error('Owner reviews requested with no space');
      return fetchOwnerReviews(spaceId, pageParam, signal);
    },
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
}

export function useOwnerReviewSummary() {
  return useQuery({
    queryKey: [...OWNER_KEY, 'summary'],
    queryFn: ({ signal }) => fetchOwnerReviewSummary(signal),
  });
}

export function useRespondToReview() {
  const client = useQueryClient();
  const intentFor = useRowIntents();
  return useMutation({
    mutationFn: ({ reviewId, response }: { reviewId: string; response: string }) =>
      respondToReview(reviewId, response, intentFor(reviewId, response)),
    onSuccess: () => void client.invalidateQueries({ queryKey: OWNER_KEY }),
  });
}
