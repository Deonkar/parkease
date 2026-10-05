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
   * Called inside the Route-activation write (spec §2): active owners only, once ever, while slots
   * remain, from now for 3 IST calendar months. Never throws into its caller: the grant runs in a
   * savepoint, so a failure is logged at error and rolled back alone, and the payout activation it
   * rides on still commits — a promotion must never block a payee from being paid.
   */
  async grantIfEligible(tx: TxHandle, userId: string): Promise<{ endsAt: Date } | null> {
    try {
      return await tx.transaction((savepoint) => this.grant(savepoint as TxHandle, userId));
    } catch (error) {
      logger.error({ userId, err: error }, 'commission waiver grant failed; activation kept');
      return null;
    }
  }

  private async grant(tx: TxHandle, userId: string): Promise<{ endsAt: Date } | null> {
    // The cheap refusals first, so valets, washers and already-waived owners never wait on the lock.
    const [owner] = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.role, Role.OWNER),
          // A pending, suspended or rejected owner role must not take one of the 50.
          eq(userRoles.status, 'active'),
        ),
      );
    if (owner === undefined) return null;
    if (await this.hasGrant(tx, userId)) return null;

    // Serialises slot assignment: two activations at once cannot both take the last free slot.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commission_waivers'))`);
    if (await this.hasGrant(tx, userId)) return null;

    // The lowest free slot, not max + 1: a granted owner deleting their account frees theirs, and
    // max + 1 would then ask for slot 51 and fail the CHECK.
    const [free] = await tx.execute<{ slot: number }>(sql`
      select s.slot from generate_series(1, ${COMMISSION_WAIVER_SLOTS}) as s(slot)
      where not exists (select 1 from commission_waivers w where w.slot = s.slot)
      order by s.slot limit 1`);
    if (free === undefined) {
      logger.info({ userId }, 'commission waiver slots are all taken');
      return null;
    }

    const [grant] = await tx
      .insert(commissionWaivers)
      .values({
        ownerId: userId,
        slot: free.slot,
        // From when we act on the activation, not from the event's own time: a webhook replayed
        // late must not spend a slot on a window that has already partly or wholly passed.
        startsAt: sql`now()`,
        // Three IST calendar months, so the end date the owner is shown is the one that applies.
        endsAt: sql`(now() AT TIME ZONE 'Asia/Kolkata' + make_interval(months => ${COMMISSION_WAIVER_MONTHS})) AT TIME ZONE 'Asia/Kolkata'`,
      })
      .returning({ endsAt: commissionWaivers.endsAt });
    if (grant === undefined) {
      throw new Error(`commission waiver insert for ${userId} returned no row`);
    }

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

  private async hasGrant(tx: TxHandle, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: commissionWaivers.id })
      .from(commissionWaivers)
      .where(eq(commissionWaivers.ownerId, userId));
    return row !== undefined;
  }
}
