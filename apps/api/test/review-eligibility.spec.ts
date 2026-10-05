import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  assertReviewable,
  type Participants,
  REVIEW_WINDOW_MS,
  type ReviewContext,
} from '../src/domains/review/eligibility.js';
import {
  BookingNotCompletedError,
  CommentTooLongError,
  ReviewWindowClosedError,
  SelfReviewError,
} from '../src/domains/review/errors.js';

const DRIVER = '0192f1c0-0000-7000-8000-00000000000d';
const OWNER = '0192f1c0-0000-7000-8000-00000000000a';
const SPACE = '0192f1c0-0000-7000-8000-000000000005';
const VALET = '0192f1c0-0000-7000-8000-00000000000e';
const WASHER_A = '0192f1c0-0000-7000-8000-0000000000a1';
const OUTSIDER = '0192f1c0-0000-7000-8000-0000000000ff';

const COMPLETED_AT = new Date('2026-10-01T10:00:00Z');

const participants = (overrides: Partial<Participants['booking']> = {}): Participants => ({
  booking: {
    id: '0192f1c0-0000-7000-8000-0000000000b0',
    status: 'completed',
    completedAt: COMPLETED_AT,
    driverId: DRIVER,
    spaceId: SPACE,
    spaceTitle: 'Basement Parking, 5th Cross',
    ownerId: OWNER,
    ...overrides,
  },
  valets: [{ userId: VALET, name: 'Ravi Kumar' }],
  washers: [{ userId: WASHER_A, name: 'Sparkle Wash' }],
});

const ctx = (overrides: Partial<ReviewContext> = {}): ReviewContext => ({
  participants: participants(),
  reviewerUserId: DRIVER,
  reviewerRole: 'driver',
  targetType: 'space',
  targetId: SPACE,
  comment: null,
  now: new Date(COMPLETED_AT.getTime() + 60_000),
  ...overrides,
});

describe('assertReviewable', () => {
  it('accepts the driver reviewing the space, the valet and a washer', () => {
    expect(() => assertReviewable(ctx())).not.toThrow();
    expect(() => assertReviewable(ctx({ targetType: 'valet', targetId: VALET }))).not.toThrow();
    expect(() => assertReviewable(ctx({ targetType: 'washer', targetId: WASHER_A }))).not.toThrow();
  });

  it('accepts the owner reviewing the driver', () => {
    expect(() =>
      assertReviewable(
        ctx({
          reviewerUserId: OWNER,
          reviewerRole: 'owner',
          targetType: 'driver',
          targetId: DRIVER,
        }),
      ),
    ).not.toThrow();
  });

  it.each(['confirmed', 'active', 'pending_payment', 'cancelled'])(
    'refuses a %s booking',
    (status) => {
      expect(() => assertReviewable(ctx({ participants: participants({ status }) }))).toThrow(
        BookingNotCompletedError,
      );
    },
  );

  it('refuses a completed booking with no completion time', () => {
    expect(() =>
      assertReviewable(ctx({ participants: participants({ completedAt: null }) })),
    ).toThrow(BookingNotCompletedError);
  });

  it('closes seven days after completion', () => {
    const at = (offsetMs: number) => new Date(COMPLETED_AT.getTime() + REVIEW_WINDOW_MS + offsetMs);
    expect(() => assertReviewable(ctx({ now: at(-1_000) }))).not.toThrow();
    expect(() => assertReviewable(ctx({ now: at(1_000) }))).toThrow(ReviewWindowClosedError);
  });

  it('answers 404 to someone who was not on the booking — before saying anything about it', () => {
    expect(() => assertReviewable(ctx({ reviewerUserId: OUTSIDER }))).toThrow(NotFoundException);
    expect(() =>
      assertReviewable(
        ctx({ reviewerUserId: OUTSIDER, participants: participants({ status: 'active' }) }),
      ),
    ).toThrow(NotFoundException);
  });

  it('answers 404 to a different owner reviewing the driver', () => {
    expect(() =>
      assertReviewable(
        ctx({
          reviewerUserId: OUTSIDER,
          reviewerRole: 'owner',
          targetType: 'driver',
          targetId: DRIVER,
        }),
      ),
    ).toThrow(NotFoundException);
  });

  it('refuses a self-review', () => {
    // An owner who booked their own space, reviewing "the driver".
    const own = participants({ driverId: OWNER });
    expect(() =>
      assertReviewable(
        ctx({
          participants: own,
          reviewerUserId: OWNER,
          reviewerRole: 'owner',
          targetType: 'driver',
          targetId: OWNER,
        }),
      ),
    ).toThrow(SelfReviewError);
  });

  it('refuses an owner reviewing their own space, booked as a driver', () => {
    const ownBooking = participants({ driverId: OWNER });
    expect(() =>
      assertReviewable(ctx({ participants: ownBooking, reviewerUserId: OWNER })),
    ).toThrow(SelfReviewError);
  });

  it('answers 404 to a target that is not on this booking', () => {
    expect(() => assertReviewable(ctx({ targetType: 'space', targetId: OUTSIDER }))).toThrow(
      NotFoundException,
    );
    expect(() => assertReviewable(ctx({ targetType: 'valet', targetId: WASHER_A }))).toThrow(
      NotFoundException,
    );
    expect(() => assertReviewable(ctx({ targetType: 'driver', targetId: OWNER }))).toThrow(
      NotFoundException,
    );
  });

  it('counts the comment in code points, as char_length does', () => {
    expect(() => assertReviewable(ctx({ comment: 'a'.repeat(500) }))).not.toThrow();
    expect(() => assertReviewable(ctx({ comment: 'a'.repeat(501) }))).toThrow(CommentTooLongError);
    // 500 emoji: 1000 UTF-16 units, 500 code points. `.length` would refuse it.
    expect(() => assertReviewable(ctx({ comment: '🚗'.repeat(500) }))).not.toThrow();
    expect(() => assertReviewable(ctx({ comment: '🚗'.repeat(501) }))).toThrow(CommentTooLongError);
  });
});
