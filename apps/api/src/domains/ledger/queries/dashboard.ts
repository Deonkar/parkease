import { Inject, Injectable } from '@nestjs/common';
import type { dashboardSchema } from '@parkease/contracts/admin';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';

import { accountTotals, imbalancedTxnIds, istRange, toDashboardMoney } from './account-totals.js';

type DashboardView = z.input<typeof dashboardSchema>;

const countsRow = z.object({
  booked: z.number().int(),
  active: z.number().int(),
  pending_spaces: z.number().int(),
  pending_partners: z.number().int(),
  reported: z.number().int(),
});
const seriesRow = z.object({ day: z.string(), gross: z.coerce.number().int().nonnegative() });

/**
 * The admin home. The four money cards come from the same `accountTotals` result the balances
 * screen reads (`toDashboardMoney`, pure), so the two screens cannot disagree. The counts are what
 * is waiting on an admin — current state, not range-bound — and are one statement, not six, so a
 * dashboard load takes three pooled connections instead of eight (S-140).
 */
@Injectable()
export class DashboardQuery {
  /**
   * Identical reads in flight share one computation (S-140): 200 operators — or one operator's
   * double-click — on the same range cost one set of ledger scans. Nothing outlives the request, so
   * the dashboard is never staler than the balances screen read at the same moment.
   */
  private readonly inFlight = new Map<string, Promise<DashboardView>>();

  constructor(@Inject(DB) private readonly db: Database) {}

  read(from: string, to: string): Promise<DashboardView> {
    const key = `${from}|${to}`;
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;
    const fresh = this.compute(from, to).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, fresh);
    return fresh;
  }

  private async compute(from: string, to: string): Promise<DashboardView> {
    const range = istRange(from, to);

    const [totals, imbalanced, countRows, seriesRows] = await Promise.all([
      accountTotals(this.db, range),
      imbalancedTxnIds(this.db, range),
      this.db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM bookings WHERE deleted_at IS NULL
             AND status NOT IN ('pending_payment', 'expired')
             AND created_at >= ${range.fromTs.toISOString()}::timestamptz
             AND created_at < ${range.toTs.toISOString()}::timestamptz) AS booked,
          (SELECT count(*)::int FROM spaces WHERE approval_status = 'active' AND deleted_at IS NULL) AS active,
          (SELECT count(*)::int FROM spaces WHERE approval_status = 'pending_approval' AND deleted_at IS NULL) AS pending_spaces,
          (SELECT count(*)::int FROM valet_profiles WHERE verification_status = 'pending')
            + (SELECT count(*)::int FROM washer_profiles WHERE verification_status = 'pending') AS pending_partners,
          (SELECT count(*)::int FROM reviews WHERE is_reported AND moderation_status = 'visible'
             AND deleted_at IS NULL) AS reported`),
      // Gross per IST day, for the chart: the same account and side as the gross card.
      this.db.execute(sql`
        SELECT to_char(occurred_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
               sum(amount_paise)::text AS gross
        FROM ledger_entries
        WHERE account = 'driver_receivable' AND direction = 'debit'
          AND occurred_at >= ${range.fromTs.toISOString()}::timestamptz
          AND occurred_at < ${range.toTs.toISOString()}::timestamptz
        GROUP BY 1 ORDER BY 1`),
    ]);

    const counts = countsRow.parse(countRows[0]);
    return {
      from,
      to,
      ...toDashboardMoney(totals, from, to),
      bookings: counts.booked,
      activeSpaces: counts.active,
      pending: {
        spaces: counts.pending_spaces,
        partners: counts.pending_partners,
        reports: counts.reported,
      },
      ledger: { balanced: imbalanced.length === 0, imbalancedTxnIds: imbalanced },
      series: z
        .array(seriesRow)
        .parse(seriesRows)
        .map((r) => ({ day: r.day, grossPaise: r.gross })),
    };
  }
}
