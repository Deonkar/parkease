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
import { parseOutgoing } from '../../../platform/http/outgoing-contract.js';
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

type ReadTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The job's `txn_id`, qualified by its table.
 *
 * Inside a select field Drizzle renders a column as its bare name, so writing
 * `${ledgerEntries.txnId} = ${washJobs.txnId}` in the correlated subqueries
 * below produced `"txn_id" = "txn_id"` — both sides resolving to the inner
 * `ledger_entries`, true for every row. Every line then summed every posting
 * in the ledger. The outer side has to name its table.
 */
const JOB_TXN_ID = sql`${washJobs}.${sql.identifier(washJobs.txnId.name)}`;

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
    /**
     * One read-only, repeatable-read transaction for both queries (database
     * L7). The summary and the lines each bound on `now()`; as two statements
     * outside a transaction they read two clocks and two snapshots, so a
     * request straddling IST midnight could count the summary by one day and
     * the lines by the next. Inside one, `now()` is the transaction's start and
     * both see the same rows. Read-only, so it can take no lock a writer waits
     * on and can never fail serialisation.
     */
    const { summary, lines } = await this.db.transaction(
      async (tx) => ({
        summary: await this.summary(tx, washerUserId, period),
        lines: await this.lines(tx, washerUserId, period),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );

    const creditsPaise = Number(summary?.creditsPaise ?? 0);
    const debitsPaise = Number(summary?.debitsPaise ?? 0);

    /**
     * The sign comes from the chart of accounts, not from a subtraction written
     * the way it happened to read here. `owner_payable` is a liability, so it
     * grows on the credit side — getting this backwards produces a statement
     * where every partner appears to owe us money.
     */
    const netPaise = signedBalancePaise(LedgerAccount.OWNER_PAYABLE, debitsPaise, creditsPaise);

    /**
     * Raw values in, no fallbacks: a completed job with no `completed_at`, no
     * price, or no posting behind it is a broken row, and the parse below
     * refusing it loudly is the right failure. Defaulting to 1970 or to zero
     * would put a plausible-looking lie on a money screen (R-FAIL-01). A NULL
     * amount stays NULL here — `Number(null)` is 0, which is exactly the lie —
     * and `parseOutgoing` turns the refusal into a 500 rather than a 400 that
     * blames the partner's phone (silent failure M9).
     */
    return parseOutgoing(
      washerEarningsViewSchema,
      {
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
          feePaise: row.feePaise === null ? null : Number(row.feePaise),
          netPaise: row.netPaise === null ? null : Number(row.netPaise),
        })),
      },
      'washer earnings view',
    );
  }

  /** Ledger movement on this partner's `owner_payable`, by posting time. */
  private async summary(tx: ReadTx, washerUserId: string, period: WasherEarningsPeriod) {
    const bound = periodBound(ledgerEntries.occurredAt, period);

    const [balance] = await tx
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
          ...(bound === undefined ? [] : [bound]),
        ),
      );

    return balance;
  }

  /**
   * One row per completed job, with the fee READ from the books rather than
   * computed. `feePaise` is the `platform_revenue` credit on the same
   * `txn_id`; subtracting net from gross would quietly relabel anything else
   * that ever posts against that transaction as commission.
   *
   * The summary's `coalesce(sum, 0)` is right — no movement in a period is
   * zero. Here it was wrong (database M3): no posting behind a completed job
   * is a missing posting, and a coalesce turned it into a ₹0 line. So `net`
   * is NULL when nothing was posted, and the response parse refuses it. `fee`
   * is NULL too, except on a 0% job: `leg()` drops zero-amount entries, so a
   * zero-commission posting legitimately has no fee leg and its fee is 0.
   */
  private async lines(tx: ReadTx, washerUserId: string, period: WasherEarningsPeriod) {
    const bound = periodBound(washJobs.completedAt, period);

    return tx
      .select({
        jobId: washJobs.id,
        serviceName: washJobs.serviceName,
        vehicleType: washJobs.vehicleType,
        completedAt: washJobs.completedAt,
        grossPaise: washJobs.pricePaise,
        feePaise: sql<string | null>`coalesce((
          select sum(${ledgerEntries.amountPaise})
          from ${ledgerEntries}
          where ${ledgerEntries.txnId} = ${JOB_TXN_ID}
            and ${ledgerEntries.account} = ${LedgerAccount.PLATFORM_REVENUE}
            and ${ledgerEntries.direction} = 'credit'
        ), case when ${washJobs.commissionRate} = 0 then 0 end)::text`,
        netPaise: sql<string | null>`(
          select sum(${ledgerEntries.amountPaise})
          from ${ledgerEntries}
          where ${ledgerEntries.txnId} = ${JOB_TXN_ID}
            and ${ledgerEntries.account} = ${LedgerAccount.OWNER_PAYABLE}
            and ${ledgerEntries.counterpartyUserId} = ${washerUserId}
            and ${ledgerEntries.direction} = 'credit'
        )::text`,
      })
      .from(washJobs)
      .where(
        and(
          eq(washJobs.washerUserId, washerUserId),
          eq(washJobs.status, 'completed'),
          ...(bound === undefined ? [] : [bound]),
        ),
      )
      .orderBy(desc(washJobs.completedAt));
  }
}
