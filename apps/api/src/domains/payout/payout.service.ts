import { Inject, Injectable } from '@nestjs/common';
import { routeStatusSchema, type RouteStatus } from '@parkease/contracts/enums';
import { draftsFromLedgerRows, type LedgerEntryDraft } from '@parkease/contracts/money';
import type { RouteRequirement } from '@parkease/contracts/shared';
import { PAYABLE_BALANCE, partnerPayable } from '@parkease/db/queries';
import {
  bankDetails,
  bookings,
  ledgerEntries,
  linkedAccounts,
  payouts,
  users,
} from '@parkease/db/schema';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

/** How far along Route onboarding a status is: breaks a tie between two same-second events. */
const LIFECYCLE: Record<RouteStatus, number> = {
  pending: 0,
  under_review: 1,
  needs_clarification: 2,
  activated: 3,
  rejected: 3,
  suspended: 3,
};
const lifecycleOf = (status: string): number => {
  const parsed = routeStatusSchema.safeParse(status);
  return parsed.success ? LIFECYCLE[parsed.data] : 0;
};

export type BankDetailsRow = typeof bankDetails.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
export type LinkedAccountRow = typeof linkedAccounts.$inferSelect;
export type LinkedAccountPatch = Partial<
  Pick<
    LinkedAccountRow,
    | 'kycStatus'
    | 'razorpayStakeholderId'
    | 'razorpayProductId'
    | 'requirements'
    | 'legalName'
    | 'settlementLast4'
    | 'settlementIfscPrefix'
  >
>;

export interface BankDetailsWrite {
  readonly userId: string;
  readonly accountNumberEncrypted: string;
  readonly ifscEncrypted: string;
  readonly accountHolderName: string;
  readonly last4: string;
  readonly ifscPrefix: string;
  readonly razorpayxContactId: string;
  readonly razorpayxFundAccountId: string;
  /** Set on a change of details (S-100); null for a first set of details. */
  readonly payoutsHeldUntil: Date | null;
}

/**
 * Every read and write against `bank_details` and `payouts` from the API.
 * Always scoped by user: a caller cannot name someone else's row (rule 7).
 */
@Injectable()
export class PayoutService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async linkedFor(userId: string): Promise<LinkedAccountRow | undefined> {
    const [row] = await this.db
      .select()
      .from(linkedAccounts)
      .where(eq(linkedAccounts.userId, userId));
    return row;
  }

  /**
   * One row per user (`linked_accounts_user_id_key`). Each onboarding step saves here before
   * the next Razorpay call, so a failure part-way resumes instead of creating a second account.
   * A single-row statement: no other row has to commit with it.
   */
  async saveLinked(
    userId: string,
    razorpayAccountId: string,
    patch: LinkedAccountPatch,
  ): Promise<LinkedAccountRow> {
    const [row] = await this.db
      .insert(linkedAccounts)
      .values({ userId, razorpayAccountId, ...patch })
      .onConflictDoUpdate({
        target: linkedAccounts.userId,
        set: { razorpayAccountId, ...patch, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) throw new Error(`linked_accounts save for ${userId} returned no row`);
    return row;
  }

  /**
   * A Route status write, ordered by when Razorpay said it. Webhooks arrive out of order with
   * distinct event ids, and the submit path races them, so each write carries its own time and
   * one no newer than the stored one is dropped: a late `under_review` never undoes
   * `activated`. The row is locked so two writers cannot both read the old time.
   *
   * Only a webhook `stamp`s its time: it is Razorpay's clock, in whole seconds. Two events in
   * the same second are told apart by how far along the lifecycle they are, so `activated` is
   * never dropped for sharing a second with `under_review`. The submit path passes its request
   * time floored to the second, defers to any webhook from that second on, and leaves the
   * stored time alone, so our clock never makes a genuine Razorpay event look stale.
   */
  async applyRouteStatus(
    tx: TxHandle,
    where: { readonly razorpayAccountId: string } | { readonly userId: string },
    next: {
      readonly status: RouteStatus;
      readonly requirements: readonly RouteRequirement[];
      readonly at: Date;
      readonly stamp: boolean;
    },
  ): Promise<
    | { readonly outcome: 'unknown' }
    | { readonly outcome: 'stale' }
    | { readonly outcome: 'applied'; readonly userId: string; readonly previous: string }
  > {
    const match =
      'userId' in where
        ? eq(linkedAccounts.userId, where.userId)
        : eq(linkedAccounts.razorpayAccountId, where.razorpayAccountId);
    const [row] = await tx
      .select({
        id: linkedAccounts.id,
        userId: linkedAccounts.userId,
        kycStatus: linkedAccounts.kycStatus,
        routeStatusAt: linkedAccounts.routeStatusAt,
      })
      .from(linkedAccounts)
      .where(match)
      .for('update');
    if (row === undefined) return { outcome: 'unknown' };
    const stored = row.routeStatusAt?.getTime() ?? null;
    const at = next.at.getTime();
    const stale =
      stored !== null &&
      (next.stamp
        ? stored > at || (stored === at && LIFECYCLE[next.status] < lifecycleOf(row.kycStatus))
        : stored >= at);
    if (stale) return { outcome: 'stale' };

    await tx
      .update(linkedAccounts)
      .set({
        kycStatus: next.status,
        requirements: next.requirements,
        routeStatusAt: next.stamp ? next.at : row.routeStatusAt,
        updatedAt: new Date(),
      })
      .where(eq(linkedAccounts.id, row.id));
    return { outcome: 'applied', userId: row.userId, previous: row.kycStatus };
  }

  /**
   * What the Monday RazorpayX run would pay this user now: the same partner-side predicate
   * the worker pays from (`@parkease/db/queries`), so the screen and the payout agree.
   */
  async payableBalance(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ balance: PAYABLE_BALANCE })
      .from(ledgerEntries)
      .leftJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .where(partnerPayable(userId));
    return Number(row?.balance ?? 0);
  }

  async phoneOf(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) throw new Error(`No user ${userId}`);
    return row.phone;
  }

  async bankFor(userId: string): Promise<BankDetailsRow | undefined> {
    const [row] = await this.db.select().from(bankDetails).where(eq(bankDetails.userId, userId));
    return row;
  }

  /** One row per user (`bank_details_user_id_key`); a change replaces it wholesale. */
  async upsertBank(tx: TxHandle, write: BankDetailsWrite): Promise<BankDetailsRow> {
    const { userId, ...fields } = write;
    const [row] = await tx
      .insert(bankDetails)
      .values(write)
      .onConflictDoUpdate({
        target: bankDetails.userId,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) throw new Error(`bank_details upsert for ${userId} returned no row`);
    return row;
  }

  /**
   * Cancels every payout not yet sent, and hands back each one's ledger posting
   * so the caller can reverse it in the same transaction. `processing` is not
   * touched: that money has already been handed to RazorpayX.
   *
   * The UPDATE's `status = 'pending'` is the race guard against `payout.send`,
   * which re-reads the row under a lock and skips anything no longer pending.
   */
  async cancelPending(
    tx: TxHandle,
    userId: string,
  ): Promise<{ id: string; entries: LedgerEntryDraft[] }[]> {
    const cancelled = await tx
      .update(payouts)
      .set({ status: 'cancelled', failureReason: 'bank details changed', updatedAt: new Date() })
      .where(and(eq(payouts.userId, userId), eq(payouts.status, 'pending')))
      .returning({ id: payouts.id, txnId: payouts.txnId });
    if (cancelled.length === 0) return [];

    const rows = await tx
      .select()
      .from(ledgerEntries)
      .where(
        inArray(
          ledgerEntries.txnId,
          cancelled.map((p) => p.txnId),
        ),
      );

    return cancelled.map((payout) => ({
      id: payout.id,
      entries: draftsFromLedgerRows(rows.filter((row) => row.txnId === payout.txnId)),
    }));
  }

  async list(userId: string, opts: { limit: number; cursor?: string }) {
    const rows = await this.db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.userId, userId),
          opts.cursor === undefined ? undefined : lt(payouts.id, opts.cursor),
        ),
      )
      .orderBy(desc(payouts.id))
      .limit(opts.limit + 1);

    const items = rows.slice(0, opts.limit);
    const hasMore = rows.length > opts.limit;
    return { items, hasMore, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async byId(userId: string, payoutId: string): Promise<PayoutRow | undefined> {
    const [row] = await this.db
      .select()
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), eq(payouts.userId, userId)));
    return row;
  }
}
