import { Inject, Injectable } from '@nestjs/common';
import { LedgerAccount } from '@parkease/contracts/enums';
import { bookings, ledgerEntries, spaces } from '@parkease/db/schema';
import { and, eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { signedBalancePaise } from '../accounts.js';

/**
 * What an owner is owed, answered from the ledger and from nothing else.
 *
 * Never recomputed from `bookings`: ADR-008 makes the ledger authoritative for
 * every question of the form "how much does X earn / owe / get back", and the
 * moment a second module starts deriving earnings from booking rows the two
 * begin to disagree — which is precisely what happened in v1, across three
 * modules that each did their own arithmetic.
 *
 * A promotional campaign is invisible here by construction. A discount is funded
 * from `promo_expense` and never touches `owner_payable` (R-MONEY-05), so a free
 * booking credits the owner exactly what a paid one would.
 *
 * Only `owner-balance` exists so far. `platform-revenue` and `statement` are in
 * task 9's file list but have no caller until the owner dashboard (task 15) and
 * payouts (task 16) — and a query with no consumer is a query whose shape is a
 * guess. Extract on the second use (R-ARCH-07).
 */
@Injectable()
export class OwnerBalanceQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Signed paise: positive means we owe the owner.
   *
   * `owner_payable` is a liability, so the sign comes from the chart rather than
   * from a subtraction written the way it happened to read at the call site.
   */
  async forOwner(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({
        debitsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
        creditsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
      })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(
        and(eq(spaces.ownerId, ownerId), eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE)),
      );

    return signedBalancePaise(
      LedgerAccount.OWNER_PAYABLE,
      Number(row?.debitsPaise ?? 0),
      Number(row?.creditsPaise ?? 0),
    );
  }

  /** The same question scoped to one booking, for a statement line. */
  async forBooking(bookingId: string): Promise<number> {
    const [row] = await this.db
      .select({
        debitsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
        creditsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.bookingId, bookingId),
          eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE),
        ),
      );

    return signedBalancePaise(
      LedgerAccount.OWNER_PAYABLE,
      Number(row?.debitsPaise ?? 0),
      Number(row?.creditsPaise ?? 0),
    );
  }
}
