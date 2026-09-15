import { describe, expect, it } from 'vitest';

import { LedgerAccount } from '../src/enums/index.js';
import {
  assertEntriesBalance,
  DiscountExceedsTotalError,
  type LedgerEntryDraft,
  promoBookingEntries,
  refundEntries,
  refundSettledEntries,
} from '../src/money/ledger-entries.js';
import { quote } from '../src/money/quote.js';
import { resolveRefund, RefundTier } from '../src/money/refund-policy.js';
import { toPaise, toRate } from '../src/primitives/paise.js';

/** ₹30/hr × 2 hrs at 1.5× surge: 9702 total, 5100 owner, 3900 fee, 702 GST. */
const CANONICAL = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });

/** The same booking with no surge: 6162 total, 5100 owner, 900 fee, 162 GST. */
const NO_SURGE = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1) });

const STARTS_AT = new Date('2026-09-15T06:30:00.000Z');
const BOOKING = { totalPaise: CANONICAL.driverTotalPaise, startsAt: STARTS_AT };

/** `[account, direction, paise]` triples, sorted, so a whole posting compares in one assertion. */
const rowsOf = (entries: readonly LedgerEntryDraft[]): string[] =>
  entries.map((entry) => `${entry.account} ${entry.direction} ${String(entry.amountPaise)}`).sort();

describe('refundEntries — before the booking starts', () => {
  const outcome = resolveRefund({
    booking: BOOKING,
    at: new Date(STARTS_AT.getTime() - 1_000),
    cancelledBy: 'driver',
  });
  const entries = refundEntries(CANONICAL, outcome, 'refund: cancelled before start');

  it('reverses all three original credits in full and re-recognises the ₹10 fee', () => {
    expect(rowsOf(entries)).toEqual(
      rowsOf([
        {
          account: LedgerAccount.OWNER_PAYABLE,
          direction: 'debit',
          amountPaise: 5100,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'debit',
          amountPaise: 3900,
          description: '',
        },
        {
          account: LedgerAccount.GST_PAYABLE,
          direction: 'debit',
          amountPaise: 702,
          description: '',
        },
        {
          account: LedgerAccount.REFUNDS_PAYABLE,
          direction: 'credit',
          amountPaise: 8702,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'credit',
          amountPaise: 1000,
          description: '',
        },
      ]),
    );
  });

  it('balances', () => {
    expect(() => {
      assertEntriesBalance(entries);
    }).not.toThrow();
  });

  it('leaves the platform exactly ₹10 across both transactions, and the owner nothing', () => {
    // Booking posted +3900 revenue and +5100 owner; this posting takes both back
    // and hands ₹10 of it to revenue. Net revenue +1000, net owner 0.
    const net = (account: string): number =>
      entries
        .filter((entry) => entry.account === account)
        .reduce(
          (total, entry) =>
            total + (entry.direction === 'credit' ? entry.amountPaise : -entry.amountPaise),
          0,
        );

    expect(net(LedgerAccount.PLATFORM_REVENUE) + CANONICAL.parkeaseFeePaise).toBe(1000);
    expect(net(LedgerAccount.OWNER_PAYABLE) + CANONICAL.ownerEarningsPaise).toBe(0);
  });
});

describe('refundEntries — within the active grace window', () => {
  const outcome = resolveRefund({ booking: BOOKING, at: STARTS_AT, cancelledBy: 'driver' });
  const entries = refundEntries(CANONICAL, outcome, 'refund: cancelled in grace');

  it('reverses proportionally, so the legs sum to the refund exactly', () => {
    expect(rowsOf(entries)).toEqual(
      rowsOf([
        {
          account: LedgerAccount.OWNER_PAYABLE,
          direction: 'debit',
          amountPaise: 2550,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'debit',
          amountPaise: 1950,
          description: '',
        },
        {
          account: LedgerAccount.GST_PAYABLE,
          direction: 'debit',
          amountPaise: 351,
          description: '',
        },
        {
          account: LedgerAccount.REFUNDS_PAYABLE,
          direction: 'credit',
          amountPaise: 4851,
          description: '',
        },
      ]),
    );
  });

  it('balances', () => {
    expect(() => {
      assertEntriesBalance(entries);
    }).not.toThrow();
  });

  it('leaves the owner half their earnings rather than all or none', () => {
    const ownerDebit = entries.find((entry) => entry.account === LedgerAccount.OWNER_PAYABLE);
    expect(CANONICAL.ownerEarningsPaise - (ownerDebit?.amountPaise ?? 0)).toBe(2550);
  });
});

describe('refundEntries — after the grace window', () => {
  it('writes nothing at all', () => {
    // No money moves, so no rows. The booking's original posting already says
    // what everyone is owed, and a cancellation that refunds nothing does not
    // change that — a zero-value reversal would be noise in the statement.
    const outcome = resolveRefund({
      booking: BOOKING,
      at: new Date(STARTS_AT.getTime() + 45 * 60_000),
      cancelledBy: 'driver',
    });

    expect(outcome.tier).toBe(RefundTier.NO_REFUND);
    expect(refundEntries(CANONICAL, outcome, 'refund: none due')).toEqual([]);
  });
});

describe('refundEntries — the owner cancels', () => {
  const outcome = resolveRefund({
    booking: BOOKING,
    at: new Date(STARTS_AT.getTime() + 5 * 60_000),
    cancelledBy: 'owner',
  });
  const entries = refundEntries(CANONICAL, outcome, 'refund: owner cancelled');

  it('reverses in full and funds the ₹50 apology as an expense', () => {
    expect(rowsOf(entries)).toEqual(
      rowsOf([
        {
          account: LedgerAccount.OWNER_PAYABLE,
          direction: 'debit',
          amountPaise: 5100,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'debit',
          amountPaise: 3900,
          description: '',
        },
        {
          account: LedgerAccount.GST_PAYABLE,
          direction: 'debit',
          amountPaise: 702,
          description: '',
        },
        {
          account: LedgerAccount.REFUNDS_PAYABLE,
          direction: 'credit',
          amountPaise: 9702,
          description: '',
        },
        {
          account: LedgerAccount.PROMO_EXPENSE,
          direction: 'debit',
          amountPaise: 5000,
          description: '',
        },
        {
          account: LedgerAccount.REFUNDS_PAYABLE,
          direction: 'credit',
          amountPaise: 5000,
          description: '',
        },
      ]),
    );
  });

  it('balances at 14702 each way', () => {
    expect(() => {
      assertEntriesBalance(entries);
    }).not.toThrow();
    const debits = entries
      .filter((entry) => entry.direction === 'debit')
      .reduce((total, entry) => total + entry.amountPaise, 0);
    expect(debits).toBe(14_702);
  });

  it('does not shrink the platform fee to pay for the goodwill', () => {
    // The apology is our expense, visible as one. It is not a discount that
    // quietly comes out of someone else's line.
    const promo = entries.find((entry) => entry.account === LedgerAccount.PROMO_EXPENSE);
    expect(promo?.amountPaise).toBe(5000);
  });
});

describe('refundSettledEntries', () => {
  it('settles the liability against the receivable when Razorpay confirms', () => {
    expect(rowsOf(refundSettledEntries(toPaise(8702), 'refund processed'))).toEqual(
      rowsOf([
        {
          account: LedgerAccount.REFUNDS_PAYABLE,
          direction: 'debit',
          amountPaise: 8702,
          description: '',
        },
        {
          account: LedgerAccount.DRIVER_RECEIVABLE,
          direction: 'credit',
          amountPaise: 8702,
          description: '',
        },
      ]),
    );
  });

  it('writes nothing for a zero settlement', () => {
    expect(refundSettledEntries(toPaise(0), 'nothing to settle')).toEqual([]);
  });
});

describe('promoBookingEntries — a discount never reaches the owner', () => {
  it('credits the owner in full on a wholly discounted booking', () => {
    expect(rowsOf(promoBookingEntries(NO_SURGE, toPaise(6162), 'promo booking'))).toEqual(
      rowsOf([
        {
          account: LedgerAccount.PROMO_EXPENSE,
          direction: 'debit',
          amountPaise: 6162,
          description: '',
        },
        {
          account: LedgerAccount.OWNER_PAYABLE,
          direction: 'credit',
          amountPaise: 5100,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'credit',
          amountPaise: 900,
          description: '',
        },
        {
          account: LedgerAccount.GST_PAYABLE,
          direction: 'credit',
          amountPaise: 162,
          description: '',
        },
      ]),
    );
  });

  it('splits the debit on a partial discount and leaves the credit side untouched', () => {
    expect(rowsOf(promoBookingEntries(NO_SURGE, toPaise(2000), 'promo booking'))).toEqual(
      rowsOf([
        {
          account: LedgerAccount.DRIVER_RECEIVABLE,
          direction: 'debit',
          amountPaise: 4162,
          description: '',
        },
        {
          account: LedgerAccount.PROMO_EXPENSE,
          direction: 'debit',
          amountPaise: 2000,
          description: '',
        },
        {
          account: LedgerAccount.OWNER_PAYABLE,
          direction: 'credit',
          amountPaise: 5100,
          description: '',
        },
        {
          account: LedgerAccount.PLATFORM_REVENUE,
          direction: 'credit',
          amountPaise: 900,
          description: '',
        },
        {
          account: LedgerAccount.GST_PAYABLE,
          direction: 'credit',
          amountPaise: 162,
          description: '',
        },
      ]),
    );
  });

  it('charges GST on a free booking — a discount is not a tax exemption', () => {
    const gst = promoBookingEntries(NO_SURGE, toPaise(6162), 'promo booking').find(
      (entry) => entry.account === LedgerAccount.GST_PAYABLE,
    );
    expect(gst?.amountPaise).toBe(162);
  });

  it('credits the owner identically whether or not a promo applied', () => {
    const ownerCredit = (discountPaise: number): number | undefined =>
      promoBookingEntries(NO_SURGE, toPaise(discountPaise), 'promo booking').find(
        (entry) => entry.account === LedgerAccount.OWNER_PAYABLE,
      )?.amountPaise;

    expect([0, 1, 2000, 6161, 6162].map(ownerCredit)).toEqual([5100, 5100, 5100, 5100, 5100]);
  });

  it('balances at every discount level', () => {
    for (const discountPaise of [0, 1, 999, 2000, 6161, 6162]) {
      expect(() => {
        assertEntriesBalance(promoBookingEntries(NO_SURGE, toPaise(discountPaise), 'promo'));
      }).not.toThrow();
    }
  });

  it('rejects a discount larger than the total', () => {
    expect(() => promoBookingEntries(NO_SURGE, toPaise(6163), 'promo')).toThrow(
      DiscountExceedsTotalError,
    );
  });
});
