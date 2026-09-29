import { Inject, Injectable } from '@nestjs/common';
import { ledgerAccountSchema, ledgerDirectionSchema } from '@parkease/contracts/enums';
import type { LedgerEntryDraft } from '@parkease/contracts/money';
import { bankDetails, ledgerEntries, payouts } from '@parkease/db/schema';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';

export type BankDetailsRow = typeof bankDetails.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;

export interface BankDetailsWrite {
  readonly userId: string;
  readonly accountNumberEncrypted: string;
  readonly ifscEncrypted: string;
  readonly accountHolderName: string;
  readonly last4: string;
  readonly ifscPrefix: string;
  readonly razorpayxContactId: string;
  readonly razorpayxFundAccountId: string;
}

/**
 * Every read and write against `bank_details` and `payouts` from the API.
 * Always scoped by user: a caller cannot name someone else's row (rule 7).
 */
@Injectable()
export class PayoutService {
  constructor(@Inject(DB) private readonly db: Database) {}

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
      entries: rows
        .filter((row) => row.txnId === payout.txnId)
        .map((row) => ({
          // Parsed, not cast: the CHECK constraint guarantees it today, and a
          // widened CHECK must fail here rather than post an unknown account.
          account: ledgerAccountSchema.parse(row.account),
          direction: ledgerDirectionSchema.parse(row.direction),
          amountPaise: row.amountPaise,
          description: row.description,
          ...(row.counterpartyUserId === null
            ? {}
            : { counterpartyUserId: row.counterpartyUserId }),
        })),
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
