import {
  type LedgerAccount,
  LedgerAccount as Account,
  ledgerAccountSchema,
  type LedgerDirection,
  ledgerDirectionSchema,
} from '../enums/index.js';
import { mulRate, type Paise, subPaise } from '../primitives/paise.js';

import { allocateProportionally } from './allocate.js';
import type { WashFee } from './carwash-fee.js';
import { type DatedRate, rateAt, TCS_RATE_HISTORY, TDS_RATE_HISTORY } from './rates.js';
import { type RefundOutcome, RefundTier } from './refund-policy.js';
import type { ValetLegFee } from './valet-fee.js';

/**
 * Not an HTTP-shaped failure with friendly copy: an unbalanced posting is a bug
 * in our own composition, never something a request did. It must abort the
 * transaction loudly rather than half-write the ledger (R-MONEY-05, R-FAIL-01).
 * The API's exception filter turns an unmapped throw into a 500, which is
 * exactly the right outcome.
 */
export class UnbalancedLedgerError extends Error {
  constructor(reason: string) {
    super(`Refusing to post an unbalanced ledger transaction: ${reason}`);
    this.name = 'UnbalancedLedgerError';
  }
}

export interface LedgerEntryDraft {
  readonly account: LedgerAccount;
  readonly direction: LedgerDirection;
  readonly amountPaise: number;
  readonly description: string;
  /**
   * Whose side of this account the row belongs to, when the posting as a whole
   * has no single answer.
   *
   * A booking posting has one counterparty and `LedgerService` stamps it on
   * every row. A valet leg does not: `owner_payable` belongs to the valet and
   * the other three belong to nobody, so tagging the whole posting would put
   * the valet's id on the driver's receivable and the earnings query would
   * count it twice (§11.6). Set here, this wins over the posting-level value.
   */
  readonly counterpartyUserId?: string;
}

/**
 * The four numbers a receivable posting needs. A fresh `Quote` satisfies this
 * structurally, and so does a stored booking row — which matters, because
 * reversing an *extended* booking must reverse the accumulated totals on the
 * row, not a quote recomputed from the original window.
 */
export interface ReceivableTotals {
  readonly driverTotalPaise: number;
  readonly ownerEarningsPaise: number;
  readonly parkeaseFeePaise: number;
  readonly gstPaise: number;
  /**
   * Commission funded from `promo_expense` for a commission-free owner (task 16c), else 0.
   * Required, not optional: a reversal built from a booking row that forgot this column would
   * not balance, and the compiler is the check.
   */
  readonly commissionWaiverPaise: number;
}

/**
 * `ledger_entries_amount_check` is `amount_paise > 0`, so a zero leg is not a
 * harmless no-op — it fails the insert and takes the whole booking with it.
 * Dropping it here keeps the posting balanced, because zero changes no sum.
 */
const leg = (
  account: LedgerAccount,
  direction: LedgerDirection,
  amountPaise: number,
  description: string,
  counterpartyUserId?: string,
): readonly LedgerEntryDraft[] =>
  amountPaise > 0
    ? [
        {
          account,
          direction,
          amountPaise,
          description,
          ...(counterpartyUserId === undefined ? {} : { counterpartyUserId }),
        },
      ]
    : [];

/**
 * A booking is created: the driver owes us the total, and that total is already
 * apportioned between the owner, the platform and the tax authority. Nothing has
 * been collected yet — capture is task 9 — so this posting establishes the
 * receivable, not cash.
 *
 * The three credits come straight from the quote, which has already asserted that
 * they sum to the driver total (ADR-008/009). This function does not recompute a
 * single rupee; `domains/pricing` is the only module that produces an amount.
 */
export function bookingReceivableEntries(
  totals: ReceivableTotals,
  description = 'booking created',
): readonly LedgerEntryDraft[] {
  return [
    ...leg(Account.DRIVER_RECEIVABLE, 'debit', totals.driverTotalPaise, description),
    // A commission-free owner's 15% is a cost ParkEase chose, so it shows as one (ADR-032).
    ...leg(Account.PROMO_EXPENSE, 'debit', totals.commissionWaiverPaise, description),
    ...leg(Account.OWNER_PAYABLE, 'credit', totals.ownerEarningsPaise, description),
    ...leg(Account.PLATFORM_REVENUE, 'credit', totals.parkeaseFeePaise, description),
    ...leg(Account.GST_PAYABLE, 'credit', totals.gstPaise, description),
  ];
}

/**
 * A booking row's money columns, in the shape a receivable posting reads. The
 * column names differ from the quote's by exactly one field — `total_paise` is
 * the driver's total — and that mismatch is the whole reason this mapper exists
 * rather than the call sites reaching for `.totalPaise` and getting it wrong.
 */
export const receivableTotalsOf = (booking: {
  totalPaise: number;
  ownerEarningsPaise: number;
  parkeaseFeePaise: number;
  gstPaise: number;
  commissionWaiverPaise: number;
}): ReceivableTotals => ({
  driverTotalPaise: booking.totalPaise,
  ownerEarningsPaise: booking.ownerEarningsPaise,
  parkeaseFeePaise: booking.parkeaseFeePaise,
  gstPaise: booking.gstPaise,
  commissionWaiverPaise: booking.commissionWaiverPaise,
});

/**
 * Corrections are reversing entries, never an UPDATE or a DELETE (R-MONEY-07,
 * enforced by the append-only trigger in migration 0007).
 */
export function reverseEntries(
  entries: readonly LedgerEntryDraft[],
  description: string,
): readonly LedgerEntryDraft[] {
  return entries.map((entry) => ({
    account: entry.account,
    direction: entry.direction === 'debit' ? ('credit' as const) : ('debit' as const),
    amountPaise: entry.amountPaise,
    description,
    // Carried, not dropped. A reversal that loses the counterparty leaves the
    // credit attributed to a valet and the debit attributed to nobody, so the
    // earnings balance never comes back down and the ledger still "balances".
    ...(entry.counterpartyUserId === undefined
      ? {}
      : { counterpartyUserId: entry.counterpartyUserId }),
  }));
}

/**
 * A posting read back from `ledger_entries`, as drafts — so it can be handed to
 * `reverseEntries`. Account and direction are PARSED, not cast: the CHECK
 * guarantees them today, and a widened CHECK must fail here rather than post an
 * account the chart does not know. Used by both writers that reverse a stored
 * payout (the API's bank-change cancel, the worker's failed payout), which must
 * change together if the row shape does.
 */
export function draftsFromLedgerRows(
  rows: readonly {
    readonly account: string;
    readonly direction: string;
    readonly amountPaise: number;
    readonly description: string;
    readonly counterpartyUserId: string | null;
  }[],
): LedgerEntryDraft[] {
  return rows.map((row) => ({
    account: ledgerAccountSchema.parse(row.account),
    direction: ledgerDirectionSchema.parse(row.direction),
    amountPaise: row.amountPaise,
    description: row.description,
    ...(row.counterpartyUserId === null ? {} : { counterpartyUserId: row.counterpartyUserId }),
  }));
}

/**
 * The invariant `ledger-balance.spec.ts` asserts table-wide, checked per posting
 * before anything reaches the database. Catching it here names the composition
 * that is wrong; catching it in the nightly job only says the ledger is broken.
 */
export function assertEntriesBalance(entries: readonly LedgerEntryDraft[]): void {
  if (entries.length === 0) {
    throw new UnbalancedLedgerError('the posting has no entries');
  }

  let debits = 0;
  let credits = 0;

  for (const entry of entries) {
    if (!Number.isInteger(entry.amountPaise) || entry.amountPaise <= 0) {
      throw new UnbalancedLedgerError(
        `${entry.account} carries ${String(entry.amountPaise)} paise, which is not a positive integer`,
      );
    }
    if (entry.direction === 'debit') debits += entry.amountPaise;
    else credits += entry.amountPaise;
  }

  if (debits !== credits) {
    throw new UnbalancedLedgerError(
      `debits ${String(debits)} do not equal credits ${String(credits)}`,
    );
  }
}

/**
 * A promotion that pays out more than the booking is worth is a funding bug, not
 * a generous campaign. Caught here rather than at the posting, so the message
 * names the discount instead of "debits do not equal credits".
 */
export class DiscountExceedsTotalError extends Error {
  constructor(discountPaise: number, totalPaise: number) {
    super(
      `Discount of ${String(discountPaise)} paise exceeds the booking total of ${String(totalPaise)} paise`,
    );
    this.name = 'DiscountExceedsTotalError';
  }
}

/**
 * Reverses the three credits a booking posted, in full, and splits the reversal
 * between what goes back to the driver and what we keep.
 *
 * The retained portion is booked gross to `platform_revenue` and the original
 * GST credit is reversed in full. Whether that retention itself attracts GST is
 * one of the open questions in ADR-021; until a CA closes it, gross is the
 * treatment that is easy to correct with a reversing entry later.
 */
function fullReversalLegs(
  totals: ReceivableTotals,
  refundPaise: number,
  retainedPaise: number,
  description: string,
): readonly LedgerEntryDraft[] {
  return [
    ...leg(Account.OWNER_PAYABLE, 'debit', totals.ownerEarningsPaise, description),
    ...leg(Account.PLATFORM_REVENUE, 'debit', totals.parkeaseFeePaise, description),
    ...leg(Account.GST_PAYABLE, 'debit', totals.gstPaise, description),
    ...leg(Account.REFUNDS_PAYABLE, 'credit', refundPaise, description),
    ...leg(Account.PLATFORM_REVENUE, 'credit', retainedPaise, description),
    // The owner's subsidised share comes back to the account that funded it (task 16c).
    ...leg(Account.PROMO_EXPENSE, 'credit', totals.commissionWaiverPaise, description),
  ];
}

/**
 * The refund posting for a resolved tier. One function rather than four, because
 * the shapes differ and pairing the wrong shape with the wrong tier is the kind
 * of mistake that balances perfectly and still pays the wrong person.
 *
 * - `before_start` and `owner_cancelled` reverse the booking **in full**: nobody
 *   earned anything, and what we keep is re-recognised as revenue in the same
 *   transaction.
 * - `active_grace` reverses **proportionally**, so owner, platform and tax each
 *   give back the same fraction the driver got back. The legs are allocated, not
 *   computed one by one, so they sum to the refund exactly.
 * - `no_refund` writes nothing. No money moves, and the booking's original
 *   posting already says what everyone is owed.
 *
 * The result is a complete posting, goodwill included — the caller hands it
 * straight to the ledger without composing anything further.
 */
export function refundEntries(
  totals: ReceivableTotals,
  outcome: RefundOutcome,
  description: string,
): readonly LedgerEntryDraft[] {
  switch (outcome.tier) {
    case RefundTier.NO_REFUND:
      return [];

    case RefundTier.BEFORE_START:
      return fullReversalLegs(totals, outcome.refundPaise, outcome.retainedPaise, description);

    case RefundTier.OWNER_CANCELLED:
      return [
        ...fullReversalLegs(totals, outcome.refundPaise, outcome.retainedPaise, description),
        // Funded, never deducted. The ₹50 is an expense we chose to incur and it
        // shows up as one, rather than quietly shrinking the owner's earnings.
        ...leg(Account.PROMO_EXPENSE, 'debit', outcome.goodwillPaise, description),
        ...leg(Account.REFUNDS_PAYABLE, 'credit', outcome.goodwillPaise, description),
      ];

    case RefundTier.ACTIVE_GRACE:
      return proportionalRefundEntries(totals, outcome.refundPaise, description);
  }
}

/**
 * Reverses a booking in the proportion `refundPaise` is of what the driver paid, so owner,
 * platform and tax each give back the same fraction. The legs are allocated, not computed
 * one by one, so they sum to the refund exactly.
 *
 * Extracted from the `ACTIVE_GRACE` tier (task 18a) because an admin-chosen refund is the
 * same posting with a different amount: one rounding rule, one place that can be wrong.
 */
export function proportionalRefundEntries(
  totals: ReceivableTotals,
  refundPaise: Paise,
  description: string,
): readonly LedgerEntryDraft[] {
  const waiver = totals.commissionWaiverPaise;
  // Allocated over what the driver paid; a commission-free owner's subsidised share comes
  // back in the same fraction, through the same helper, so there is one rounding rule.
  const [ownerPaise = 0, feePaise = 0, gstPaise = 0] = allocateProportionally(refundPaise, [
    totals.ownerEarningsPaise - waiver,
    totals.parkeaseFeePaise,
    totals.gstPaise,
  ]);
  const [waiverPaise = 0] =
    waiver === 0
      ? [0]
      : allocateProportionally(refundPaise, [waiver, totals.driverTotalPaise - waiver]);

  return [
    ...leg(Account.OWNER_PAYABLE, 'debit', ownerPaise + waiverPaise, description),
    ...leg(Account.PLATFORM_REVENUE, 'debit', feePaise, description),
    ...leg(Account.GST_PAYABLE, 'debit', gstPaise, description),
    ...leg(Account.PROMO_EXPENSE, 'credit', waiverPaise, description),
    ...leg(Account.REFUNDS_PAYABLE, 'credit', refundPaise, description),
  ];
}

/**
 * Razorpay confirms the money left (`refund.processed`), so the liability we
 * recorded is settled against the receivable the driver owed.
 *
 * Deliberately separate from `refundEntries`: the liability is recorded the
 * moment we decide to refund, and discharged only when the gateway says the
 * money moved. Collapsing the two would claim cash had moved before it had.
 */
export function refundSettledEntries(
  refundPaise: number,
  description: string,
): readonly LedgerEntryDraft[] {
  return [
    ...leg(Account.REFUNDS_PAYABLE, 'debit', refundPaise, description),
    ...leg(Account.DRIVER_RECEIVABLE, 'credit', refundPaise, description),
  ];
}

/**
 * A booking created under a promotional discount.
 *
 * A discount reduces what the driver pays. It does not reduce what the owner
 * earns, and it does not skip GST. That is enforced structurally rather than by
 * convention: the three credits are the same three an undiscounted booking
 * posts, read from the same totals, so a promo has no path to reach them. Only
 * the debit side changes — the discount is funded out of `promo_expense`.
 *
 * Owner earnings are answered by summing `owner_payable`, so a campaign shows up
 * on the platform's side and is invisible on the owner's (R-MONEY-05).
 */
export function promoBookingEntries(
  totals: ReceivableTotals,
  discountPaise: number,
  description = 'booking created',
): readonly LedgerEntryDraft[] {
  if (discountPaise > totals.driverTotalPaise) {
    throw new DiscountExceedsTotalError(discountPaise, totals.driverTotalPaise);
  }

  return [
    ...leg(
      Account.DRIVER_RECEIVABLE,
      'debit',
      totals.driverTotalPaise - discountPaise,
      description,
    ),
    ...leg(Account.PROMO_EXPENSE, 'debit', discountPaise, description),
    // A commission-free owner's waiver is promo money too; without it the posting is short (16c).
    ...leg(Account.PROMO_EXPENSE, 'debit', totals.commissionWaiverPaise, description),
    ...leg(Account.OWNER_PAYABLE, 'credit', totals.ownerEarningsPaise, description),
    ...leg(Account.PLATFORM_REVENUE, 'credit', totals.parkeaseFeePaise, description),
    ...leg(Account.GST_PAYABLE, 'credit', totals.gstPaise, description),
  ];
}

/**
 * One valet leg, on the books. §11.6.
 *
 * The driver owes the fee plus GST; the valet is credited the fee less our
 * commission; we take the commission; the tax authority is owed GST on the
 * commission alone. `computeValetLegFee` has already asserted that the three
 * credits sum to the debit, so this function recomputes nothing.
 *
 * `owner_payable` is the platform's payable-to-supplier account, not an
 * owner-only account (ADR-008). A valet's balance and a space owner's balance
 * are the same query with a different `counterparty_user_id`, which is why this
 * does not invent a `partner_payable` that would fork every payout,
 * reconciliation and statement query in tasks 15 and 16.
 */
export function valetLegEntries(
  fee: ValetLegFee,
  valetUserId: string,
  description: string,
): readonly LedgerEntryDraft[] {
  return [
    ...leg(Account.DRIVER_RECEIVABLE, 'debit', fee.driverTotalPaise, description),
    ...leg(Account.OWNER_PAYABLE, 'credit', fee.valetEarningsPaise, description, valetUserId),
    ...leg(Account.PLATFORM_REVENUE, 'credit', fee.commissionPaise, description),
    ...leg(Account.GST_PAYABLE, 'credit', fee.gstPaise, description),
  ];
}

/**
 * The driver did not turn up, or cancelled after the valet was dispatched. §11.8.
 *
 * The outbound leg was already charged at accept, so this gives back the
 * *difference* between what was charged and what is retained rather than
 * charging the call-out on top of a full leg. Each of the three credits the
 * original posting made is debited by its own overage, and the total goes to
 * `refunds_payable` — the liability we owe the driver, discharged when the
 * gateway confirms the money moved (`refundSettledEntries`).
 *
 * Returns an empty posting when there is nothing to give back. That is not a
 * balanced zero set: `assertEntriesBalance` rejects an empty posting, so the
 * caller must skip the write rather than hand this straight to the ledger.
 */
export function valetChargeAdjustmentEntries(
  charged: ValetLegFee,
  retained: ValetLegFee,
  valetUserId: string,
  description: string,
): readonly LedgerEntryDraft[] {
  if (retained.driverTotalPaise > charged.driverTotalPaise) {
    throw new RangeError(
      `Refusing to retain ${String(retained.driverTotalPaise)} paise against a charge of ` +
        `${String(charged.driverTotalPaise)} paise: an adjustment cannot refund more than was charged`,
    );
  }

  // subPaise, not a raw minus. Paise is a non-negative brand and subPaise is
  // where that brand is enforced; subtracting with `-` bypasses the underflow
  // guard and leans on an unstated monotonicity argument between two separate
  // computeValetLegFee calls. One edit to the fee model away from that
  // invariant would post a silently negative ledger entry instead of throwing.
  const refundPaise = subPaise(charged.driverTotalPaise, retained.driverTotalPaise);
  if (refundPaise === 0) return [];

  return [
    ...leg(
      Account.OWNER_PAYABLE,
      'debit',
      subPaise(charged.valetEarningsPaise, retained.valetEarningsPaise),
      description,
      valetUserId,
    ),
    ...leg(
      Account.PLATFORM_REVENUE,
      'debit',
      subPaise(charged.commissionPaise, retained.commissionPaise),
      description,
    ),
    ...leg(
      Account.GST_PAYABLE,
      'debit',
      subPaise(charged.gstPaise, retained.gstPaise),
      description,
    ),
    ...leg(Account.REFUNDS_PAYABLE, 'credit', refundPaise, description),
  ];
}

/**
 * One car wash, on the books. §13.7.
 *
 * The driver owes the price plus GST; the partner is credited the price less
 * our commission; we take the commission; the tax authority is owed GST on the
 * commission alone. `computeWashFee` has already produced three credits that
 * sum to the debit, so this function recomputes nothing.
 *
 * `owner_payable` is the platform's payable-to-supplier account, not an
 * owner-only account (ADR-008). A washer's balance, a valet's balance and a
 * space owner's balance are the same query with a different
 * `counterparty_user_id`, which is why this does not invent a `partner_payable`
 * that would fork every payout, reconciliation and statement query in tasks 15
 * and 16.
 */
export function washEntries(
  fee: WashFee,
  washerUserId: string,
  description: string,
): readonly LedgerEntryDraft[] {
  return [
    ...leg(Account.DRIVER_RECEIVABLE, 'debit', fee.driverTotalPaise, description),
    ...leg(Account.OWNER_PAYABLE, 'credit', fee.washerEarningsPaise, description, washerUserId),
    ...leg(Account.PLATFORM_REVENUE, 'credit', fee.commissionPaise, description),
    ...leg(Account.GST_PAYABLE, 'credit', fee.gstPaise, description),
  ];
}

/**
 * Route moved a share out at capture: we no longer owe it, and it is in transit
 * until reconciliation sees Razorpay's transfer (ADR-030).
 *
 * `counterpartyUserId` is whoever the original credit was stamped with — the
 * DRIVER for a parking booking (so the owner-side predicate still matches it),
 * the washer for a wash. The clearing leg belongs to nobody.
 */
export function routeDischargeEntries(
  amountPaise: number,
  counterpartyUserId: string,
): readonly LedgerEntryDraft[] {
  const description = 'route transfer at capture';
  return [
    ...leg(Account.OWNER_PAYABLE, 'debit', amountPaise, description, counterpartyUserId),
    ...leg(Account.SETTLEMENT_CLEARING, 'credit', amountPaise, description),
  ];
}

/**
 * The rail confirmed the money arrived. There is no cash account (ADR-008: the
 * ledger records obligations, not a bank statement), so the transit leg closes
 * against the drivers' money that funded it (ADR-030).
 */
export function settlementClearedEntries(amountPaise: number): readonly LedgerEntryDraft[] {
  const description = 'settlement confirmed';
  return [
    ...leg(Account.SETTLEMENT_CLEARING, 'debit', amountPaise, description),
    ...leg(Account.DRIVER_RECEIVABLE, 'credit', amountPaise, description),
  ];
}

export interface PayoutPosting {
  readonly entries: readonly LedgerEntryDraft[];
  readonly tcsPaise: Paise;
  readonly tdsPaise: Paise;
  readonly netPaise: Paise;
}

/**
 * A RazorpayX payout of a partner's whole payable balance. §16.6.
 *
 * TCS and TDS are read at the payout's date from the dated histories, so the
 * CA's answer to ADR-021 is a new row in `rates.ts`, not a code change. Both
 * are 0 today, and a zero leg is dropped rather than written (`leg`).
 * `rates` exists so the non-zero case is testable; production passes nothing.
 */
export function payoutEntries(
  grossPaise: Paise,
  payeeUserId: string,
  at: Date,
  rates: { readonly tcs: readonly DatedRate[]; readonly tds: readonly DatedRate[] } = {
    tcs: TCS_RATE_HISTORY,
    tds: TDS_RATE_HISTORY,
  },
): PayoutPosting {
  const tcsPaise = mulRate(grossPaise, rateAt(rates.tcs, at));
  const tdsPaise = mulRate(grossPaise, rateAt(rates.tds, at));
  const netPaise = subPaise(subPaise(grossPaise, tcsPaise), tdsPaise);
  const description = 'payout';

  return {
    tcsPaise,
    tdsPaise,
    netPaise,
    entries: [
      ...leg(Account.OWNER_PAYABLE, 'debit', grossPaise, description, payeeUserId),
      ...leg(Account.SETTLEMENT_CLEARING, 'credit', netPaise, description),
      ...leg(Account.TCS_PAYABLE, 'credit', tcsPaise, description),
      ...leg(Account.TDS_PAYABLE, 'credit', tdsPaise, description),
    ],
  };
}
