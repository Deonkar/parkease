import { Inject, Injectable } from '@nestjs/common';
import { Role } from '@parkease/contracts/enums';
import {
  COMMISSION_WAIVER_MONTHS,
  COMMISSION_WAIVER_SLOTS,
  istDateOf,
} from '@parkease/contracts/money';
import { commissionWaivers, userRoles } from '@parkease/db/schema';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';
import { logger } from '../../platform/observability/logger.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';

/**
 * Who is commission-free, and until when (task 16c, ADR-032). Pricing's input, not its output:
 * the quote decides the money, this only says whether the owner's window holds the quote's time.
 */
@Injectable()
export class CommissionWaiverService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

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

  /**
   * Called inside the Route-activation write (spec §2). Owners only, once ever, while slots
   * remain. The advisory lock serialises slot assignment, so two activations at once cannot both
   * read "49 taken"; the unique and CHECK constraints make any mistake fail loudly rather than
   * over-grant. A grant tells the owner in the same commit: an owner who does not know they are
   * commission-free gets nothing from the offer.
   */
  async grantIfEligible(tx: TxHandle, userId: string, at: Date): Promise<{ endsAt: Date } | null> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commission_waivers'))`);

    const [owner] = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, Role.OWNER)));
    if (owner === undefined) return null;

    const [existing] = await tx
      .select({ id: commissionWaivers.id })
      .from(commissionWaivers)
      .where(eq(commissionWaivers.ownerId, userId));
    if (existing !== undefined) return null;

    const [taken] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${commissionWaivers.slot}), 0)::int`,
      })
      .from(commissionWaivers);
    if ((taken?.count ?? 0) >= COMMISSION_WAIVER_SLOTS) {
      logger.info({ userId }, 'commission waiver slots are all taken');
      return null;
    }

    const [grant] = await tx
      .insert(commissionWaivers)
      .values({
        ownerId: userId,
        slot: (taken?.last ?? 0) + 1,
        startsAt: at,
        endsAt: sql`${at.toISOString()}::timestamptz + make_interval(months => ${COMMISSION_WAIVER_MONTHS})`,
      })
      .returning({ endsAt: commissionWaivers.endsAt });
    if (grant === undefined)
      throw new Error(`commission waiver insert for ${userId} returned no row`);

    await this.outbox.enqueue(tx, {
      type: 'notification.dispatch',
      payload: {
        userId,
        template: 'promo.commission_waiver_granted',
        data: { endsOn: istDateOf(grant.endsAt) },
      },
    });
    return grant;
  }
}
