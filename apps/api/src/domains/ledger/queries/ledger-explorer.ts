import { Inject, Injectable } from '@nestjs/common';
import type { ledgerEntrySchema, LedgerQuery } from '@parkease/contracts/admin';
import { ledgerAccountSchema, ledgerDirectionSchema } from '@parkease/contracts/enums';
import { ledgerEntries } from '@parkease/db/schema';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { istDayStart } from '../../../platform/db/ist.js';
import {
  afterInstantCursor,
  decodeInstantCursor,
  encodeInstantCursor,
  instantText,
} from '../../../platform/http/instant-cursor.js';

type EntryView = z.input<typeof ledgerEntrySchema>;

export interface LedgerPage {
  readonly items: EntryView[];
  readonly meta: {
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

/**
 * The ledger explorer: newest first, paged by `(occurred_at, id)` keyset so a page costs the same
 * on row one million as on row fifty, and a posting that lands between two requests cannot shift
 * the next page the way an OFFSET would. `id` breaks ties: every row of one posting shares an
 * `occurred_at`, so without it the order within a posting is arbitrary and a page could split it
 * differently on each read.
 */
@Injectable()
export class LedgerExplorerQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  async page(q: LedgerQuery): Promise<LedgerPage> {
    const cursor = q.cursor === undefined ? undefined : decodeInstantCursor(q.cursor);

    const where: (SQL | undefined)[] = [
      q.account === undefined ? undefined : eq(ledgerEntries.account, q.account),
      q.txnId === undefined ? undefined : eq(ledgerEntries.txnId, q.txnId),
      q.bookingId === undefined ? undefined : eq(ledgerEntries.bookingId, q.bookingId),
      q.payoutId === undefined ? undefined : eq(ledgerEntries.payoutId, q.payoutId),
      // A one-sided range is legal here (a filter, not a report): each end is its own bound.
      q.from === undefined ? undefined : gte(ledgerEntries.occurredAt, istDayStart(q.from)),
      q.to === undefined ? undefined : lt(ledgerEntries.occurredAt, istDayStart(q.to)),
      cursor === undefined
        ? undefined
        : afterInstantCursor(ledgerEntries.occurredAt, ledgerEntries.id, cursor),
    ];

    // One extra row says whether there is a next page without a count.
    const rows = await this.db
      .select({
        id: ledgerEntries.id,
        txnId: ledgerEntries.txnId,
        account: ledgerEntries.account,
        direction: ledgerEntries.direction,
        amountPaise: ledgerEntries.amountPaise,
        bookingId: ledgerEntries.bookingId,
        payoutId: ledgerEntries.payoutId,
        description: ledgerEntries.description,
        occurredAt: ledgerEntries.occurredAt,
        occurredAtText: instantText(ledgerEntries.occurredAt),
      })
      .from(ledgerEntries)
      .where(and(...where))
      .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const pageRows = rows.slice(0, q.limit);
    const last = pageRows.at(-1);

    return {
      items: pageRows.map((row) => ({
        id: row.id,
        txnId: row.txnId,
        account: ledgerAccountSchema.parse(row.account),
        direction: ledgerDirectionSchema.parse(row.direction),
        amountPaise: row.amountPaise,
        bookingId: row.bookingId,
        payoutId: row.payoutId,
        description: row.description,
        occurredAt: row.occurredAt.toISOString(),
      })),
      meta: {
        limit: q.limit,
        hasMore,
        nextCursor:
          hasMore && last !== undefined
            ? encodeInstantCursor({ occurredAt: last.occurredAtText, id: last.id })
            : null,
      },
    };
  }
}
