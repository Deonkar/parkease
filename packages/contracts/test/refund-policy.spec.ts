import { describe, expect, it } from 'vitest';

import {
  ACTIVE_GRACE_MINUTES,
  OWNER_CANCEL_GOODWILL_PAISE,
  REFUND_PROCESSING_FEE_PAISE,
  RefundTier,
  resolveRefund,
} from '../src/money/refund-policy.js';
import { toPaise } from '../src/primitives/paise.js';

/** The canonical booking: ₹30/hr × 2 hrs at 1.5× surge, starting at noon IST. */
const STARTS_AT = new Date('2026-09-15T06:30:00.000Z');
const BOOKING = { totalPaise: toPaise(9702), startsAt: STARTS_AT };

const minutesAfterStart = (minutes: number, seconds = 0): Date =>
  new Date(STARTS_AT.getTime() + minutes * 60_000 + seconds * 1_000);

describe('resolveRefund — the published tiers in prd.md §8', () => {
  it('refunds everything but the processing fee a second before the start', () => {
    const outcome = resolveRefund({
      booking: BOOKING,
      at: minutesAfterStart(0, -1),
      cancelledBy: 'driver',
    });

    expect(outcome).toEqual({
      tier: RefundTier.BEFORE_START,
      refundPaise: 8702,
      retainedPaise: 1000,
      goodwillPaise: 0,
    });
  });

  it('treats the start instant itself as inside the grace window, not before it', () => {
    // The boundary a driver actually hits. `at < startsAt` is before; `at ===
    // startsAt` is the first moment of the booking they are cancelling out of.
    const outcome = resolveRefund({ booking: BOOKING, at: STARTS_AT, cancelledBy: 'driver' });

    expect(outcome.tier).toBe(RefundTier.ACTIVE_GRACE);
    expect(outcome.refundPaise).toBe(4851);
    expect(outcome.retainedPaise).toBe(4851);
  });

  it('still refunds half at 29 minutes 59 seconds', () => {
    const outcome = resolveRefund({
      booking: BOOKING,
      at: minutesAfterStart(ACTIVE_GRACE_MINUTES - 1, 59),
      cancelledBy: 'driver',
    });

    expect(outcome.tier).toBe(RefundTier.ACTIVE_GRACE);
    expect(outcome.refundPaise).toBe(4851);
  });

  it('refunds nothing from the thirtieth minute exactly', () => {
    const outcome = resolveRefund({
      booking: BOOKING,
      at: minutesAfterStart(ACTIVE_GRACE_MINUTES),
      cancelledBy: 'driver',
    });

    expect(outcome).toEqual({
      tier: RefundTier.NO_REFUND,
      refundPaise: 0,
      retainedPaise: 9702,
      goodwillPaise: 0,
    });
  });

  it('refunds everything plus goodwill when the owner cancels, whenever that is', () => {
    for (const at of [minutesAfterStart(-60), STARTS_AT, minutesAfterStart(600)]) {
      expect(resolveRefund({ booking: BOOKING, at, cancelledBy: 'owner' })).toEqual({
        tier: RefundTier.OWNER_CANCELLED,
        refundPaise: 9702,
        retainedPaise: 0,
        goodwillPaise: OWNER_CANCEL_GOODWILL_PAISE,
      });
    }
  });

  it('treats an admin cancellation exactly like an owner cancellation', () => {
    // Not the driver's fault either way, so they are not charged for it.
    expect(
      resolveRefund({ booking: BOOKING, at: minutesAfterStart(120), cancelledBy: 'admin' }).tier,
    ).toBe(RefundTier.OWNER_CANCELLED);
  });
});

describe('resolveRefund — amounts that cannot go negative', () => {
  it('retains the whole total rather than a fee it cannot cover', () => {
    // A ₹5 booking cannot pay a ₹10 processing fee. Retaining the total is the
    // only answer that does not hand the driver a negative refund.
    const tiny = { totalPaise: toPaise(500), startsAt: STARTS_AT };
    const outcome = resolveRefund({
      booking: tiny,
      at: minutesAfterStart(-1),
      cancelledBy: 'driver',
    });

    expect(outcome.tier).toBe(RefundTier.BEFORE_START);
    expect(outcome.refundPaise).toBe(0);
    expect(outcome.retainedPaise).toBe(500);
  });

  it('retains exactly the fee when the total is exactly the fee', () => {
    const exact = { totalPaise: REFUND_PROCESSING_FEE_PAISE, startsAt: STARTS_AT };
    const outcome = resolveRefund({
      booking: exact,
      at: minutesAfterStart(-1),
      cancelledBy: 'driver',
    });

    expect(outcome.refundPaise).toBe(0);
    expect(outcome.retainedPaise).toBe(REFUND_PROCESSING_FEE_PAISE);
  });

  it('always splits the total into exactly refund plus retained', () => {
    const totals = [0, 1, 999, 1000, 1001, 4851, 9702, 123_457];
    const moments = [
      minutesAfterStart(-1),
      STARTS_AT,
      minutesAfterStart(29),
      minutesAfterStart(30),
    ];

    for (const totalPaise of totals) {
      for (const at of moments) {
        const outcome = resolveRefund({
          booking: { totalPaise: toPaise(totalPaise), startsAt: STARTS_AT },
          at,
          cancelledBy: 'driver',
        });

        expect(outcome.refundPaise + outcome.retainedPaise).toBe(totalPaise);
        expect(outcome.refundPaise).toBeGreaterThanOrEqual(0);
        expect(outcome.retainedPaise).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rounds an odd-paise half-refund without leaving a stray paisa', () => {
    const odd = { totalPaise: toPaise(4_861), startsAt: STARTS_AT };
    const outcome = resolveRefund({ booking: odd, at: STARTS_AT, cancelledBy: 'driver' });

    expect(outcome.refundPaise + outcome.retainedPaise).toBe(4_861);
    expect(Number.isInteger(outcome.refundPaise)).toBe(true);
  });
});

describe('the published amounts are constants, not literals at call sites', () => {
  it('matches prd.md §8: ₹10 processing fee, ₹50 goodwill, 30 minute grace', () => {
    expect(REFUND_PROCESSING_FEE_PAISE).toBe(1_000);
    expect(OWNER_CANCEL_GOODWILL_PAISE).toBe(5_000);
    expect(ACTIVE_GRACE_MINUTES).toBe(30);
  });
});
