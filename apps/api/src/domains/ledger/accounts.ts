import { LedgerAccount } from '@parkease/contracts/enums';

export type NormalBalance = 'debit' | 'credit';
export type AccountKind = 'asset' | 'liability' | 'revenue' | 'expense';

export interface AccountDefinition {
  /** What an increase looks like. It is what turns entries into a signed number. */
  readonly normalBalance: NormalBalance;
  readonly kind: AccountKind;
}

/**
 * The chart of accounts from ADR-008.
 *
 * `normalBalance` is not decoration: a balance query that sums debits minus
 * credits gives the right sign for an asset and the wrong one for a liability.
 * Reading it from here is what stops each query re-deciding, which is how v1's
 * three modules came to disagree about the same booking.
 *
 * What the ledger models, and what it does not: it records obligations between
 * parties — what the driver owes, what the owner is due, what the government is
 * due, what we earned. It is not a bank statement. Cash sits with Razorpay until
 * settlement, and `gateway_fees` plus the settlement clearing entries are posted
 * by the reconciliation job in task 16, which reads Route settlement reports and
 * matches them against these `txn_id`s (ADR-013).
 *
 * `tcs_payable` and `tds_payable` exist and are unused at launch. They are here
 * from day one so the correct tax treatment is a configuration change rather
 * than a migration (ADR-021).
 */
export const ACCOUNTS = {
  [LedgerAccount.DRIVER_RECEIVABLE]: { normalBalance: 'debit', kind: 'asset' },
  [LedgerAccount.OWNER_PAYABLE]: { normalBalance: 'credit', kind: 'liability' },
  [LedgerAccount.REFUNDS_PAYABLE]: { normalBalance: 'credit', kind: 'liability' },
  [LedgerAccount.GST_PAYABLE]: { normalBalance: 'credit', kind: 'liability' },
  [LedgerAccount.TCS_PAYABLE]: { normalBalance: 'credit', kind: 'liability' },
  [LedgerAccount.TDS_PAYABLE]: { normalBalance: 'credit', kind: 'liability' },
  [LedgerAccount.PLATFORM_REVENUE]: { normalBalance: 'credit', kind: 'revenue' },
  [LedgerAccount.GATEWAY_FEES]: { normalBalance: 'debit', kind: 'expense' },
  [LedgerAccount.PROMO_EXPENSE]: { normalBalance: 'debit', kind: 'expense' },
} as const satisfies Record<LedgerAccount, AccountDefinition>;

/**
 * Turns raw debit and credit totals into the number a human means when they ask
 * what an account holds.
 *
 * "The owner is owed ₹51" is `owner_payable` at +5100, not −5100, even though
 * credits exceed debits — because a liability grows on the credit side. Getting
 * this backwards produces a statement where every owner appears to owe us money.
 */
export function signedBalancePaise(
  account: LedgerAccount,
  debitsPaise: number,
  creditsPaise: number,
): number {
  return ACCOUNTS[account].normalBalance === 'debit'
    ? debitsPaise - creditsPaise
    : creditsPaise - debitsPaise;
}
