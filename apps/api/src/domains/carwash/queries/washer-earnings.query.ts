import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccount } from '@parkease/contracts/enums';
import {
  washerEarningsViewSchema,
  type WasherEarningsPeriod,
  type WasherEarningsView,
} from '@parkease/contracts/washer';
import { ledgerEntries, washJobs } from '@parkease/db/schema';
import { and, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { signedBalancePaise } from '../../ledger/accounts.js';

/**
 * Period bound in Asia/Kolkata. A partner's week starts when THEIR week
 * starts, not when UTC's does — in IST those differ by five and a half
 * hours, which is the difference between a Monday morning job counting
 * toward last week and this one.
 *
 * Written once and called against both `ledger_entries.occurred_at` (the
 * summary) and `wash_jobs.completed_at` (the lines): they are genuinely
 * different columns, but two hand-written copies of this boundary is exactly
 * how the two ends up disagreeing about when the week started.
 *
 * `all` returns no bound, which is the behaviour this endpoint had before.
 */
function periodBound(column: SQLWrapper, period: WasherEarningsPeriod): SQL | undefined {
  if (period === 'all') return undefined;

  const unit = period === 'today' ? 'day' : period;
  return sql`${column} >= date_trunc(${unit}, now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
}

/**
 * What a car wash partner has earned, answered from the ledger and nothing else.
 *
 * Never recomputed by summing `wash_jobs.price_paise`: ADR-008 makes the ledger
 * authoritative for every question of the form "how much does X earn", and the
 * moment a second module starts deriving earnings from business rows the two
 * begin to disagree — which is exactly what happened in v1 across three modules
 * that each did their own arithmetic (R-MONEY-05). Summing the job rows would
 * also be *wrong* rather than merely duplicative: a cancelled job's reversal
 * lives only in the ledger, so the job table says a partner is owed money for
 * work that was called off.
 *
 * The account is `owner_payable` filtered by `counterparty_user_id`. That is
 * not a hack around a missing account: `owner_payable` is the platform's
 * payable-to-supplier account (ADR-008), so a washer's balance, a valet's and a
 * space owner's are the same query with a different id.
 *
 * **Two instants, and the two halves of the answer need not sum.** The summary
 * is ledger movement by POSTING time (`ledger_entries.occurred_at`): the credit
 * posts at accept, a cancellation's reversal posts at cancel under a new
 * `txn_id`. The lines and `jobsCompleted` are jobs COMPLETED in the period, by
 * `wash_jobs.completed_at`. A job accepted this week and still washing moves
 * this week's net with no line; a job accepted last week and completed this
 * week has a line this week while its money is in last week's summary. Both
 * definitions are kept on purpose — see `washerEarningsViewSchema`.
 *
 * Because the summary is movement rather than a balance, a bounded period's
 * `netPaise` can be negative: a reversal posted this week against a credit
 * posted last week. Only `all` is the balance we owe the partner.
 */
@Injectable()
export class WasherEarningsQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forWasher(
    washerUserId: string,
    period: WasherEarningsPeriod = 'week',
  ): Promise<WasherEarningsView> {
    const summaryBound = periodBound(ledgerEntries.occurredAt, period);

    const [balance] = await this.db
      .select({
        debitsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
        creditsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE),
          eq(ledgerEntries.counterpartyUserId, washerUserId),
          ...(summaryBound === undefined ? [] : [summaryBound]),
        ),
      );

    const creditsPaise = Number(balance?.creditsPaise ?? 0);
    const debitsPaise = Number(balance?.debitsPaise ?? 0);

    /**
     * The sign comes from the chart of accounts, not from a subtraction written
     * the way it happened to read here. `owner_payable` is a liability, so it
     * grows on the credit side — getting this backwards produces a statement
     * where every partner appears to owe us money.
     */
    const netPaise = signedBalancePaise(LedgerAccount.OWNER_PAYABLE, debitsPaise, creditsPaise);

    const linesBound = periodBound(washJobs.completedAt, period);

    /**
     * One row per completed job, with the fee READ from the books rather than
     * computed. `feePaise` is the `platform_revenue` credit on the same
     * `txn_id`; subtracting net from gross would quietly relabel anything else
     * that ever posts against that transaction as commission.
     */
    const lines = await this.db
      .select({
        jobId: washJobs.id,
        serviceName: washJobs.serviceName,
        vehicleType: washJobs.vehicleType,
        completedAt: washJobs.completedAt,
        grossPaise: washJobs.pricePaise,
        feePaise: sql<string>`coalesce((
          select sum(${ledgerEntries.amountPaise})
          from ${ledgerEntries}
          where ${ledgerEntries.txnId} = ${washJobs.txnId}
            and ${ledgerEntries.account} = ${LedgerAccount.PLATFORM_REVENUE}
            and ${ledgerEntries.direction} = 'credit'
        ), 0)::text`,
        netPaise: sql<string>`coalesce((
          select sum(${ledgerEntries.amountPaise})
          from ${ledgerEntries}
          where ${ledgerEntries.txnId} = ${washJobs.txnId}
            and ${ledgerEntries.account} = ${LedgerAccount.OWNER_PAYABLE}
            and ${ledgerEntries.counterpartyUserId} = ${washerUserId}
            and ${ledgerEntries.direction} = 'credit'
        ), 0)::text`,
      })
      .from(washJobs)
      .where(
        and(
          eq(washJobs.washerUserId, washerUserId),
          eq(washJobs.status, 'completed'),
          ...(linesBound === undefined ? [] : [linesBound]),
        ),
      )
      .orderBy(desc(washJobs.completedAt));

    /**
     * Raw values in, no fallbacks: a completed job with no `completed_at`, or
     * no price, is a broken row, and the parse below refusing it loudly is the
     * right failure. Defaulting to 1970 or to a zero price would put a
     * plausible-looking lie on a money screen (R-FAIL-01). Migration 0030's
     * `wash_jobs_assignee_presence_check` already guarantees the price on a
     * completed row; `completed_at` has no such CHECK yet (suggestedtask.md).
     */
    return washerEarningsViewSchema.parse({
      period,
      summary: {
        grossPaise: creditsPaise,
        reversedPaise: debitsPaise,
        netPaise,
        jobsCompleted: lines.length,
      },
      lines: lines.map((row) => ({
        jobId: row.jobId,
        serviceName: row.serviceName,
        vehicleType: row.vehicleType,
        completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
        grossPaise: row.grossPaise,
        feePaise: Number(row.feePaise),
        netPaise: Number(row.netPaise),
      })),
    });
  }
}
