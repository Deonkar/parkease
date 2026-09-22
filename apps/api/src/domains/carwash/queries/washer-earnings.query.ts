import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccount } from '@parkease/contracts/enums';
import { washerEarningsSummarySchema } from '@parkease/contracts/washer';
import { ledgerEntries, washJobs } from '@parkease/db/schema';
import { and, count, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { signedBalancePaise } from '../../ledger/accounts.js';

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
 */
@Injectable()
export class WasherEarningsQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forWasher(washerUserId: string) {
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

    const [completed] = await this.db
      .select({ jobs: count() })
      .from(washJobs)
      .where(and(eq(washJobs.washerUserId, washerUserId), eq(washJobs.status, 'completed')));

    // Parsed, not cast: the branded Paise type exists so a plain number cannot
    // reach a money field without passing the schema that defines it.
    return washerEarningsSummarySchema.parse({
      grossPaise: creditsPaise,
      reversedPaise: debitsPaise,
      netPaise,
      jobsCompleted: completed?.jobs ?? 0,
    });
  }
}
