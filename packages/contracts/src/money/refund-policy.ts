import { mulRate, toPaise, toRate, type Paise } from '../primitives/paise.js';

/**
 * The published refund policy from `prd.md` §8, as a pure function.
 *
 * It lives in contracts rather than in `apps/api` for the reason every money
 * rule ends up here: the worker is a separate deployable with no Nest container,
 * and a second copy of a refund tier is exactly how v1 ended up with three
 * modules that disagreed about the same booking (R-ARCH-07).
 *
 * The amounts are named constants because a `1_000` at a call site is a number
 * nobody can grep for when finance asks why we kept ₹10 (R-GEN-05).
 */
export const REFUND_PROCESSING_FEE_PAISE = 1_000 as Paise;
export const OWNER_CANCEL_GOODWILL_PAISE = 5_000 as Paise;
export const ACTIVE_GRACE_MINUTES = 30;
export const ACTIVE_GRACE_REFUND_RATE = toRate(0.5);

export const RefundTier = {
  BEFORE_START: 'before_start',
  ACTIVE_GRACE: 'active_grace',
  NO_REFUND: 'no_refund',
  OWNER_CANCELLED: 'owner_cancelled',
} as const;

export type RefundTier = (typeof RefundTier)[keyof typeof RefundTier];

/** Who pulled the trigger. It is the only input that can override the clock. */
export type CancelledBy = 'driver' | 'owner' | 'admin';

export interface RefundContext {
  /**
   * Plain `number` rather than branded `Paise`, for the same reason
   * `allocateProportionally` takes plain integers: the total arrives as a
   * booking row's money column, and taking `Paise` would push an `as Paise`
   * assertion onto data from outside the process (R-VAL-01). It is parsed
   * below instead, so a rupee amount or a fraction is rejected rather than
   * silently used.
   */
  readonly booking: { readonly totalPaise: number; readonly startsAt: Date };
  readonly at: Date;
  readonly cancelledBy: CancelledBy;
}

export interface RefundOutcome {
  readonly tier: RefundTier;
  /** Goes back to the driver. */
  readonly refundPaise: Paise;
  /** Stays with the booking — `refundPaise + retainedPaise === totalPaise`, always. */
  readonly retainedPaise: Paise;
  /** An apology we fund ourselves, never a deduction from someone else. */
  readonly goodwillPaise: Paise;
}

export function resolveRefund(input: RefundContext): RefundOutcome {
  const { at, cancelledBy } = input;
  // Parses, never asserts: throws on a fraction, a negative, or a rupee amount
  // that wandered in wearing the wrong name.
  const booking = {
    totalPaise: toPaise(input.booking.totalPaise),
    startsAt: input.booking.startsAt,
  };

  // Not the driver's fault, so they are not charged for it — at any hour, even
  // mid-booking. The goodwill is a separate expense, not a larger refund.
  if (cancelledBy === 'owner' || cancelledBy === 'admin') {
    return {
      tier: RefundTier.OWNER_CANCELLED,
      refundPaise: booking.totalPaise,
      retainedPaise: 0 as Paise,
      goodwillPaise: OWNER_CANCEL_GOODWILL_PAISE,
    };
  }

  if (at.getTime() < booking.startsAt.getTime()) {
    // A ₹5 booking cannot pay a ₹10 fee. Capping at the total is what keeps the
    // refund from going negative, which is the one failure mode here that would
    // read as us charging someone to cancel.
    const retainedPaise = Math.min(REFUND_PROCESSING_FEE_PAISE, booking.totalPaise) as Paise;
    return {
      tier: RefundTier.BEFORE_START,
      refundPaise: (booking.totalPaise - retainedPaise) as Paise,
      retainedPaise,
      goodwillPaise: 0 as Paise,
    };
  }

  const graceEndsAt = booking.startsAt.getTime() + ACTIVE_GRACE_MINUTES * 60_000;
  if (at.getTime() < graceEndsAt) {
    const refundPaise = mulRate(booking.totalPaise, ACTIVE_GRACE_REFUND_RATE);
    // Subtracting rather than halving twice: two roundings of the same number
    // need not sum back to it, and these two must.
    return {
      tier: RefundTier.ACTIVE_GRACE,
      refundPaise,
      retainedPaise: (booking.totalPaise - refundPaise) as Paise,
      goodwillPaise: 0 as Paise,
    };
  }

  return {
    tier: RefundTier.NO_REFUND,
    refundPaise: 0 as Paise,
    retainedPaise: booking.totalPaise,
    goodwillPaise: 0 as Paise,
  };
}
