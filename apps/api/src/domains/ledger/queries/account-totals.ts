import { Inject, Injectable } from '@nestjs/common';
import type { Dashboard, FinanceBalances } from '@parkease/contracts/admin';
import {
  LEDGER_ACCOUNT_VALUES,
  type LedgerAccount,
  ledgerAccountSchema,
} from '@parkease/contracts/enums';
import { toPaise } from '@parkease/contracts/primitives';
import { ledgerEntries } from '@parkease/db/schema';
import { and, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { istDayStart } from '../../../platform/db/ist.js';

export type Reader = Pick<Database, 'select'>;

export interface IstRange {
  readonly fromTs: Date;
  readonly toTs: Date;
}

export const istRange = (from: string, to: string): IstRange => ({
  fromTs: istDayStart(from),
  toTs: istDayStart(to),
});

export interface AccountTotal {
  readonly account: LedgerAccount;
  readonly debitsPaise: number;
  readonly creditsPaise: number;
}

/**
 * `sum(bigint)` is `numeric`, which postgres.js hands back as a string. A string that does not fit
 * a JS number exactly is a ledger the arithmetic can no longer be trusted on, so it fails loudly
 * instead of rounding: 2^53 paise is ninety trillion rupees, and reaching it means a bug, not growth.
 */
const sumSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger, 'a ledger total exceeded Number.MAX_SAFE_INTEGER');

const totalRowSchema = z.object({
  account: ledgerAccountSchema,
  debits: sumSchema,
  credits: sumSchema,
});

/**
 * THE ledger aggregate. Every finance figure the admin panel shows is derived from this one
 * `GROUP BY account`: the balances screen, each dashboard card, the Dr/Cr totals. Two screens that
 * ask the ledger two slightly different questions will, sooner or later, give two different
 * answers to "what did we earn this month"; deriving both from one result makes that impossible
 * rather than unlikely.
 *
 * All ten accounts come back, zero-filled, in chart order, so a missing row is never mistaken for
 * a zero and the screens never have to know which accounts have seen activity.
 */
export async function accountTotals(db: Reader, range: IstRange): Promise<readonly AccountTotal[]> {
  const rows = await db
    .select({
      account: ledgerEntries.account,
      debits: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
        filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
      credits: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
        filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
    })
    .from(ledgerEntries)
    .where(
      and(gte(ledgerEntries.occurredAt, range.fromTs), lt(ledgerEntries.occurredAt, range.toTs)),
    )
    .groupBy(ledgerEntries.account);

  const byAccount = new Map(
    rows.map((row) => {
      const parsed = totalRowSchema.parse(row);
      return [parsed.account, parsed] as const;
    }),
  );

  return LEDGER_ACCOUNT_VALUES.map((account) => ({
    account,
    debitsPaise: byAccount.get(account)?.debits ?? 0,
    creditsPaise: byAccount.get(account)?.credits ?? 0,
  }));
}

/** Pure: which side an account leans to is the sign of debits - credits, nothing else. */
export function toBalances(
  totals: readonly AccountTotal[],
  from: string,
  to: string,
): FinanceBalances {
  let totalDebitsPaise = 0;
  let totalCreditsPaise = 0;

  const accounts = totals.map(({ account, debitsPaise, creditsPaise }) => {
    totalDebitsPaise += debitsPaise;
    totalCreditsPaise += creditsPaise;
    const difference = debitsPaise - creditsPaise;
    return {
      account,
      debitsPaise: toPaise(debitsPaise),
      creditsPaise: toPaise(creditsPaise),
      balancePaise: toPaise(Math.abs(difference)),
      side: difference === 0 ? null : difference > 0 ? ('dr' as const) : ('cr' as const),
    };
  });

  return {
    from,
    to,
    accounts,
    totalDebitsPaise: toPaise(totalDebitsPaise),
    totalCreditsPaise: toPaise(totalCreditsPaise),
    balanced: totalDebitsPaise === totalCreditsPaise,
  };
}

const slice = (account: LedgerAccount, side: 'debit' | 'credit', from: string, to: string) => ({
  account,
  side,
  from,
  to,
});

type Money = Pick<
  Dashboard,
  'grossPaise' | 'platformRevenuePaise' | 'ownerPayablePaise' | 'gstPayablePaise' | 'queries'
>;

/**
 * Pure, and reading the same totals `toBalances` reads, so a card and its row on the balances
 * screen are one number. Each card also carries the exact ledger slice it was computed from
 * (`queries`): the "Show queries" panel is a statement of what was summed, not a second computation.
 *
 * - gross: what drivers were charged, the debits of `driver_receivable`.
 * - platform revenue: what the platform booked, the credits of `platform_revenue`.
 * - owner payable: what owners were credited, the credits of `owner_payable`.
 * - GST: what is owed to the tax authority, the credits of `gst_payable`.
 *
 * All four are one-sided on purpose: reversals (cancellations, refunds) post the opposite side, so
 * they show on the balances screen as debits and are not netted away here. A card that silently
 * subtracted them could no longer be reproduced by `SUM(...) WHERE direction = ...`.
 */
export function toDashboardMoney(totals: readonly AccountTotal[], from: string, to: string): Money {
  const of = (account: LedgerAccount): AccountTotal => {
    const found = totals.find((total) => total.account === account);
    if (found === undefined) throw new Error(`accountTotals returned no row for ${account}`);
    return found;
  };

  return {
    grossPaise: toPaise(of('driver_receivable').debitsPaise),
    platformRevenuePaise: toPaise(of('platform_revenue').creditsPaise),
    ownerPayablePaise: toPaise(of('owner_payable').creditsPaise),
    gstPayablePaise: toPaise(of('gst_payable').creditsPaise),
    queries: {
      gross: slice('driver_receivable', 'debit', from, to),
      platformRevenue: slice('platform_revenue', 'credit', from, to),
      ownerPayable: slice('owner_payable', 'credit', from, to),
      gstPayable: slice('gst_payable', 'credit', from, to),
    },
  };
}

/** Never more than this many ids: a corrupted ledger is a page of evidence, not a response body. */
const IMBALANCE_REPORT_LIMIT = 100;

const imbalanceRowSchema = z.object({ txn_id: z.string().uuid() });

/**
 * Postings that do not balance, bounded by the same range as the totals. The invariant is per
 * `txn_id` (every posting is written in one transaction, so its rows share one `occurred_at`),
 * which is why a range cannot split a posting and report a false imbalance.
 */
export async function imbalancedTxnIds(db: Database, range: IstRange): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT txn_id
    FROM ledger_entries
    WHERE occurred_at >= ${range.fromTs.toISOString()}::timestamptz
      AND occurred_at < ${range.toTs.toISOString()}::timestamptz
    GROUP BY txn_id
    HAVING coalesce(sum(amount_paise) FILTER (WHERE direction = 'debit'), 0)
        <> coalesce(sum(amount_paise) FILTER (WHERE direction = 'credit'), 0)
    ORDER BY txn_id
    LIMIT ${IMBALANCE_REPORT_LIMIT}
  `);
  return rows.map((row) => imbalanceRowSchema.parse(row).txn_id);
}

/** The balances screen. A class only because the controller may not hold a database handle. */
@Injectable()
export class FinanceBalancesQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async read(from: string, to: string): Promise<FinanceBalances> {
    return toBalances(await accountTotals(this.db, istRange(from, to)), from, to);
  }
}
