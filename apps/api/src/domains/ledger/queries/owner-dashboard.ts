import { Inject, Injectable } from '@nestjs/common';
import { ledgerEntries, users } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { SpaceOccupancyQuery } from '../../space/queries/occupancy.js';
import { istStartOfToday, lastMonthToDate, periodBound } from '../period-bound.js';

import { OwnerBalanceQuery, type StatementRow } from './owner-balance.js';

export interface OwnerDashboardData {
  readonly greetingName: string | null;
  readonly owedPaise: number;
  readonly today: { readonly netPaise: number; readonly bookings: number };
  readonly month: { readonly netPaise: number; readonly growthBp: number | null };
  readonly statement: readonly StatementRow[];
  readonly spaces: readonly {
    id: string;
    title: string;
    approvalStatus: string;
    occupancyBp: number;
  }[];
}

/**
 * Everything the owner dashboard shows, read in ONE repeatable-read snapshot
 * so today, the month and the balance cannot straddle a posting (the washer
 * query's rationale). Every money figure is an `OwnerBalanceQuery` call —
 * this class adds no arithmetic on paise beyond the growth ratio.
 */
@Injectable()
export class OwnerDashboardQuery {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly balance: OwnerBalanceQuery,
    private readonly occupancy: SpaceOccupancyQuery,
  ) {}

  async forOwner(ownerId: string): Promise<OwnerDashboardData> {
    return this.db.transaction(
      async (tx) => {
        // The occupancy window's end is the request instant — no caller ever
        // passed a different `now` (YAGNI), so it is computed here rather than
        // threaded through as a parameter.
        const now = new Date();
        const at = ledgerEntries.occurredAt;
        // Owed, not earned: settlements count, so a Route-paid booking is not owed twice.
        const owedPaise = await this.balance.balance(ownerId, tx);
        const today = await this.balance.movement(ownerId, periodBound(at, 'today'), tx);
        const month = await this.balance.movement(ownerId, periodBound(at, 'month'), tx);
        const lastMonth = await this.balance.movement(ownerId, lastMonthToDate(at), tx);
        const bookingsToday = await this.balance.statementCount(ownerId, 'today', tx);
        const statement = await this.balance.statementPage(
          ownerId,
          { period: 'all', limit: 3 },
          tx,
        );
        const spaceRows = await this.occupancy.forOwner(
          ownerId,
          { from: istStartOfToday(now), to: now },
          tx,
        );

        const [owner] = await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, ownerId));

        const first = owner?.name?.trim().split(/\s+/)[0];

        return {
          greetingName: first === undefined || first === '' ? null : first,
          owedPaise,
          today: { netPaise: today.netPaise, bookings: bookingsToday },
          month: {
            netPaise: month.netPaise,
            // null for a zero or negative baseline — a reversal-heavy last month is not a base to grow from.
            growthBp:
              lastMonth.netPaise > 0
                ? Math.round(((month.netPaise - lastMonth.netPaise) * 10_000) / lastMonth.netPaise)
                : null,
          },
          statement: statement.items,
          spaces: spaceRows,
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
