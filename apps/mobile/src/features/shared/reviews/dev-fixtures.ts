import {
  type CreateReview,
  type PendingReview,
  pendingReviewSchema,
  type PublicReviewView,
  publicReviewViewSchema,
  type ReviewView,
  reviewViewSchema,
} from '@parkease/contracts/driver';
import {
  type OwnerSpaceReviewSummary,
  ownerSpaceReviewSummarySchema,
} from '@parkease/contracts/owner';

import { listDevMockSpaces } from '@/lib/dev-mock-store';

/**
 * What the review screens show in a dev-mock session (web preview, no API). Parsed through the
 * real contracts, so a fixture that drifts from them fails loudly instead of rendering a shape the
 * server never sends. In-memory: a write is visible until a full page reload, like the owner store.
 */
const BOOKING = '0192f1c0-0000-7000-8000-0000000000b0';
const SPACE = '0192f1b3-0000-7000-8000-000000000001';
const VALET = '0192f1c0-0000-7000-8000-0000000000e1';
const WASHER = '0192f1c0-0000-7000-8000-0000000000a1';

const id = (n: number) => `0192f1c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const SAMPLES: readonly [number, string, string | null, number][] = [
  [5, 'Ravi Kumar', 'Easy to find, gate was open, no fuss.', 2],
  [3, 'Anita Menon', 'Tight for a sedan but it worked.', 21],
  [5, 'Kiran Patil', 'Covered and well lit. Will book again.', 25],
  [4, 'Meera Iyer', null, 33],
  [2, 'Arjun Rao', 'Gate was closed. Had to call the owner.', 40],
  [5, 'Sana Khan', 'Owner was helpful with directions.', 52],
  [4, 'Vikram Shah', 'Good spot near the metro.', 64],
  [5, 'Divya N', 'Exactly as in the photos.', 80],
];

const reviewed = new Set<string>();
const responses = new Map<string, string>();

function review(i: number): ReviewView {
  const [rating, name, comment, age] = SAMPLES[i] ?? [5, 'Driver', null, 1];
  const first = name.split(' ');
  const reviewId = id(1000 + i);
  const response = responses.get(reviewId) ?? (i === 0 ? 'Thanks Ravi, see you again.' : null);
  return reviewViewSchema.parse({
    id: reviewId,
    bookingId: BOOKING,
    targetType: 'space',
    targetId: SPACE,
    rating,
    comment,
    reviewerName: first.length > 1 ? `${first[0] ?? ''} ${(first[1] ?? '')[0] ?? ''}.` : name,
    createdAt: daysAgo(age),
    ownerResponse: response,
    ownerRespondedAt: response === null ? null : daysAgo(Math.max(age - 1, 0)),
    isReported: i === 4,
  });
}

const PAGE = 5;

function pageAt<T>(items: T[], cursor: string | undefined, idOf: (t: T) => string) {
  const start = cursor === undefined ? 0 : items.findIndex((t) => idOf(t) === cursor) + 1;
  const data = items.slice(start, start + PAGE);
  const hasMore = start + PAGE < items.length;
  return {
    data,
    meta: { limit: PAGE, hasMore, nextCursor: hasMore ? idOf(data[data.length - 1] as T) : null },
  };
}

const allReviews = (): ReviewView[] => SAMPLES.map((_, i) => review(i));

export const devReviews = {
  pending(): PendingReview[] {
    const targets = [
      { targetType: 'space', targetId: SPACE, name: 'Basement Parking, 5th Cross' },
      { targetType: 'valet', targetId: VALET, name: 'Ravi K.' },
      { targetType: 'washer', targetId: WASHER, name: 'Sparkle Wash' },
    ].map((t) => ({ ...t, reviewed: reviewed.has(t.targetId) }));
    if (targets.every((t) => t.reviewed)) return [];
    return [
      pendingReviewSchema.parse({
        bookingId: BOOKING,
        spaceTitle: 'Basement Parking, 5th Cross',
        completedAt: daysAgo(1),
        reviewableUntil: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        targets,
      }),
    ];
  },

  create(body: CreateReview): ReviewView {
    reviewed.add(body.targetId);
    return reviewViewSchema.parse({
      id: id(2000 + reviewed.size),
      bookingId: body.bookingId,
      targetType: body.targetType,
      targetId: body.targetId,
      rating: body.rating,
      comment: body.comment ?? null,
      reviewerName: 'You',
      createdAt: new Date().toISOString(),
      ownerResponse: null,
      ownerRespondedAt: null,
      isReported: false,
    });
  },

  spacePage(cursor: string | undefined): {
    data: PublicReviewView[];
    meta: ReturnType<typeof pageAt>['meta'];
  } {
    // `.strip()` drops the report flag, as the API's public view does.
    const visible = allReviews().map((r) => publicReviewViewSchema.strip().parse(r));
    return pageAt(visible, cursor, (r) => r.id);
  },

  ownerPage(cursor: string | undefined) {
    return pageAt(allReviews(), cursor, (r) => r.id);
  },

  /** One summary per listing in this dev session, so whichever listing the owner opens has one. */
  ownerSummary(): OwnerSpaceReviewSummary[] {
    const listings = [
      { id: SPACE, title: 'Basement Parking, 5th Cross' },
      ...listDevMockSpaces().map((space) => ({ id: space.id, title: space.title })),
    ];
    return listings.map((listing) =>
      ownerSpaceReviewSummarySchema.parse({
        spaceId: listing.id,
        spaceTitle: listing.title,
        ratingAvgBp: 42_000,
        ratingCount: SAMPLES.length,
        distribution: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 4 },
        reportedCount: 1,
      }),
    );
  },

  respond(reviewId: string, response: string): ReviewView {
    responses.set(reviewId, response);
    const found = allReviews().find((r) => r.id === reviewId);
    if (found === undefined) throw new Error(`dev fixture has no review ${reviewId}`);
    return found;
  },

  /** For the space-detail fixture: the summary and the three newest, as the API sends them. */
  spaceDetailReviews() {
    return {
      reviewSummary: {
        ratingAvgBp: 42_000,
        ratingCount: SAMPLES.length,
        distribution: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 4 },
      },
      recentReviews: this.spacePage(undefined).data.slice(0, 3),
    };
  },
};
