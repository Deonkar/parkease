import type { ReportReview } from '@parkease/contracts/driver';
import type { BookingId } from '@parkease/contracts/primitives';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { newIntent, type Intent } from '@/lib/api';

import {
  createReview,
  fetchOwnerReviews,
  fetchOwnerReviewSummary,
  fetchPendingReviews,
  fetchSpaceReviews,
  reportReview,
  respondToReview,
} from './api';
import type { SheetRow } from './sheet-state';

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
 * One intent per counterparty, kept for the sheet's life (R-FE-05). A row that failed and is
 * submitted again is the same review, so it reuses its key: if the first attempt did land, the
 * server replays it instead of answering "already reviewed".
 */
function useRowIntents() {
  const intents = useRef(new Map<string, Intent>());
  return (targetId: string): Intent => {
    let intent = intents.current.get(targetId);
    if (intent === undefined) {
      intent = newIntent();
      intents.current.set(targetId, intent);
    }
    return intent;
  };
}

export interface SubmitResult {
  readonly saved: ReadonlySet<string>;
  readonly failed: number;
}

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
        rated.map((row) =>
          createReview(
            {
              bookingId,
              targetType: row.targetType,
              targetId: row.targetId,
              rating: row.rating,
              ...(row.comment.trim() === '' ? {} : { comment: row.comment }),
            },
            intentFor(row.targetId),
          ),
        ),
      );
      const saved = new Set(
        rated.filter((_, i) => results[i]?.status === 'fulfilled').map((row) => row.targetId),
      );
      return { saved, failed: rated.length - saved.size };
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
      reportReview(as, reviewId, body, intentFor(reviewId)),
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
      respondToReview(reviewId, response, intentFor(reviewId)),
    onSuccess: () => void client.invalidateQueries({ queryKey: OWNER_KEY }),
  });
}
