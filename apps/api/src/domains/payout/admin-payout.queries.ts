import { Inject, Injectable } from '@nestjs/common';
import type {
  adminPayoutSchema,
  PayoutsQuery,
  reconciliationItemSchema,
} from '@parkease/contracts/admin';
import { payoutStatusSchema } from '@parkease/contracts/enums';
import { payouts, reconciliationMismatches } from '@parkease/db/schema';
import { and, desc, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { IstRange } from '../ledger/queries/account-totals.js';

type PayoutView = z.input<typeof adminPayoutSchema>;
type ReconciliationView = z.input<typeof reconciliationItemSchema>;

/**
 * More than a review screen can show, fewer than an unbounded read of a table that only grows. A
 * mismatch is an exception to be cleared, so a range holding more than this is itself the finding.
 */
const RECONCILIATION_LIMIT = 1000;

/**
 * What the admin panel reads about money leaving the platform: the weekly payouts, and the
 * reconciliation findings the nightly job could not explain. Read-only: nothing here moves money
 * (an admin cannot trigger a payout, ADR-013), and the bank-account columns of a payout never leave.
 */
@Injectable()
export class AdminPayoutQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(q: PayoutsQuery): Promise<{ items: PayoutView[]; total: number }> {
    const where: SQL | undefined = and(
      q.status === undefined ? undefined : eq(payouts.status, q.status),
      q.userId === undefined ? undefined : eq(payouts.userId, q.userId),
    );

    const [rows, [count]] = await Promise.all([
      this.db
        .select({
          id: payouts.id,
          userId: payouts.userId,
          period: payouts.period,
          grossPaise: payouts.grossPaise,
          netPaise: payouts.netPaise,
          status: payouts.status,
          razorpayPayoutId: payouts.razorpayPayoutId,
          failureReason: payouts.failureReason,
          createdAt: payouts.createdAt,
        })
        .from(payouts)
        .where(where)
        .orderBy(desc(payouts.createdAt), desc(payouts.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(payouts)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        status: payoutStatusSchema.parse(row.status),
        createdAt: row.createdAt.toISOString(),
      })),
      total: count?.total ?? 0,
    };
  }

  /** Findings raised in the range, newest first, resolved or not: the screen filters on `resolvedAt`. */
  async reconciliation(range: IstRange): Promise<ReconciliationView[]> {
    const rows = await this.db
      .select()
      .from(reconciliationMismatches)
      .where(
        and(
          gte(reconciliationMismatches.createdAt, range.fromTs),
          lt(reconciliationMismatches.createdAt, range.toTs),
        ),
      )
      .orderBy(desc(reconciliationMismatches.createdAt), desc(reconciliationMismatches.id))
      .limit(RECONCILIATION_LIMIT);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      reference: row.reference,
      expectedPaise: row.expectedPaise,
      actualPaise: row.actualPaise,
      detail: row.detail,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
