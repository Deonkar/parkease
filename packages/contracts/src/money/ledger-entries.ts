import {
  type LedgerAccount,
  LedgerAccount as Account,
  type LedgerDirection,
} from '../enums/index.js';

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
): readonly LedgerEntryDraft[] =>
  amountPaise > 0 ? [{ account, direction, amountPaise, description }] : [];

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
}): ReceivableTotals => ({
  driverTotalPaise: booking.totalPaise,
  ownerEarningsPaise: booking.ownerEarningsPaise,
  parkeaseFeePaise: booking.parkeaseFeePaise,
  gstPaise: booking.gstPaise,
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
