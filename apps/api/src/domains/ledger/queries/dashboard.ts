import { Inject, Injectable } from '@nestjs/common';
import type { dashboardSchema } from '@parkease/contracts/admin';
import type { BookingStatus } from '@parkease/contracts/enums';
import { bookings, reviews, spaces, valetProfiles, washerProfiles } from '@parkease/db/schema';
import { and, eq, gte, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';

import { accountTotals, imbalancedTxnIds, istRange, toDashboardMoney } from './account-totals.js';

type DashboardView = z.input<typeof dashboardSchema>;

/** Never paid: the receivable was reversed to zero, so these are not business done. */
const UNPAID: BookingStatus[] = ['pending_payment', 'expired'];

const count = sql<number>`count(*)::int`;

/**
 * The admin home. The four money cards and the ledger health line come from the same
 * `accountTotals` result the balances screen reads (the money half is `toDashboardMoney`, pure),
 * so the two screens cannot disagree. The counts are what is waiting on an admin: they are
 * current-state reads, not range-bound, because a queue is not a report.
 */
@Injectable()
export class DashboardQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async read(from: string, to: string): Promise<DashboardView> {
    const range = istRange(from, to);

    const [
      totals,
      imbalanced,
      [booked],
      [active],
      [pendingSpaces],
      [pendingValets],
      [pendingWashers],
      [reported],
    ] = await Promise.all([
      accountTotals(this.db, range),
      imbalancedTxnIds(this.db, range),
      this.db
        .select({ n: count })
        .from(bookings)
        .where(
          and(
            isNull(bookings.deletedAt),
            notInArray(bookings.status, UNPAID),
            gte(bookings.createdAt, range.fromTs),
            lt(bookings.createdAt, range.toTs),
          ),
        ),
      this.db
        .select({ n: count })
        .from(spaces)
        .where(and(eq(spaces.approvalStatus, 'active'), isNull(spaces.deletedAt))),
      this.db
        .select({ n: count })
        .from(spaces)
        .where(and(eq(spaces.approvalStatus, 'pending_approval'), isNull(spaces.deletedAt))),
      this.db
        .select({ n: count })
        .from(valetProfiles)
        .where(eq(valetProfiles.verificationStatus, 'pending')),
      this.db
        .select({ n: count })
        .from(washerProfiles)
        .where(eq(washerProfiles.verificationStatus, 'pending')),
      this.db
        .select({ n: count })
        .from(reviews)
        .where(and(eq(reviews.isReported, true), eq(reviews.moderationStatus, 'visible'))),
    ]);

    return {
      from,
      to,
      ...toDashboardMoney(totals, from, to),
      bookings: booked?.n ?? 0,
      activeSpaces: active?.n ?? 0,
      pending: {
        spaces: pendingSpaces?.n ?? 0,
        partners: (pendingValets?.n ?? 0) + (pendingWashers?.n ?? 0),
        reports: reported?.n ?? 0,
      },
      ledger: { balanced: imbalanced.length === 0, imbalancedTxnIds: imbalanced },
    };
  }
}
