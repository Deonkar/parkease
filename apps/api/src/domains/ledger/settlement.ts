import { LedgerAccount } from '@parkease/contracts/enums';
import { ledgerEntries } from '@parkease/db/schema';
import { sql } from 'drizzle-orm';

/**
 * True for a `ledger_entries` row whose transaction carries no
 * `settlement_clearing` leg — i.e. anything but a rail moving money out
 * (a Route discharge at capture, a payout, their clearings and reversals).
 *
 * Every EARNINGS read ANDs this in (ADR-030, S-46). Without it a Route transfer
 * or a payout reads as "reversed", because both debit `owner_payable` exactly
 * as a cancellation does. A BALANCE read ("what do we still owe") must not.
 *
 * The outer column is written out as `"ledger_entries"."txn_id"`: in a correlated
 * subquery over the same table, a bare column reference resolves to the inner
 * alias and correlates nothing (learnings: "Drizzle renders a column in a select
 * field as its bare name").
 */
export const notSettlement = () =>
  sql`not exists (select 1 from ledger_entries s
    where s.txn_id = ${ledgerEntries}.${sql.identifier(ledgerEntries.txnId.name)}
      and s.account = ${LedgerAccount.SETTLEMENT_CLEARING})`;
