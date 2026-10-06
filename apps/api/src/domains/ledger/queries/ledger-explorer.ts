import { Inject, Injectable } from '@nestjs/common';
import type { ledgerEntrySchema, LedgerQuery } from '@parkease/contracts/admin';
import { ledgerAccountSchema, ledgerDirectionSchema } from '@parkease/contracts/enums';
import { ledgerEntries } from '@parkease/db/schema';
import { and, desc, eq, gte, lt, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';

import { istDayStart } from './account-totals.js';

type EntryView = z.input<typeof ledgerEntrySchema>;

/**
 * `occurred_at` at full microsecond precision. A JS `Date` carries milliseconds, so a cursor built
 * from one would sit up to 999 microseconds before the row it names, and that row would come back
 * on the next page. The cursor is therefore the text Postgres itself formats.
 */
const OCCURRED_AT_TEXT = sql<string>`to_char(${ledgerEntries.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const cursorSchema = z.object({
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.string().uuid(),
});

type Cursor = z.infer<typeof cursorSchema>;

const SEPARATOR = '|';

export const encodeLedgerCursor = (cursor: Cursor): string =>
  Buffer.from(`${cursor.occurredAt}${SEPARATOR}${cursor.id}`, 'utf8').toString('base64url');

/**
 * A cursor is client input however opaque it looks: it is parsed, and a malformed one is a
 * ZodError, which the exception filter answers as 400 VALIDATION_FAILED.
 */
export function decodeLedgerCursor(raw: string): Cursor {
  const [occurredAt, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split(SEPARATOR);
  return cursorSchema.parse({ occurredAt, id: rest.length === 0 ? id : undefined });
}

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
    const cursor = q.cursor === undefined ? undefined : decodeLedgerCursor(q.cursor);

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
        : sql`(${ledgerEntries.occurredAt}, ${ledgerEntries.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`,
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
        occurredAtText: OCCURRED_AT_TEXT,
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
            ? encodeLedgerCursor({ occurredAt: last.occurredAtText, id: last.id })
            : null,
      },
    };
  }
}
