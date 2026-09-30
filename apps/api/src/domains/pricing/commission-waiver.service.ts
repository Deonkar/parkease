import { Inject, Injectable } from '@nestjs/common';
import { commissionWaivers } from '@parkease/db/schema';
import { and, eq, gt, lte } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

/**
 * Who is commission-free, and until when (task 16c, ADR-032). Pricing's input, not its output:
 * the quote decides the money, this only says whether the owner's window holds the quote's time.
 */
@Injectable()
export class CommissionWaiverService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async activeFor(ownerId: string, at: Date): Promise<{ endsAt: Date } | null> {
    const [row] = await this.db
      .select({ endsAt: commissionWaivers.endsAt })
      .from(commissionWaivers)
      .where(
        and(
          eq(commissionWaivers.ownerId, ownerId),
          lte(commissionWaivers.startsAt, at),
          gt(commissionWaivers.endsAt, at),
        ),
      );
    return row ?? null;
  }
}
