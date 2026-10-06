import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

/**
 * The keyset cursor of every admin list that pages newest-first by `(timestamp, id)`: the ledger
 * explorer and the audit log. Extracted on its second use (R-ARCH-07) because the two must change
 * together: a fix to how a cursor is validated that reached one list and not the other would leave
 * the other answering a forged cursor with a 500.
 */

/**
 * A column at full microsecond precision, as the text Postgres itself formats. A JS `Date` carries
 * milliseconds, so a cursor built from one would sit up to 999 microseconds before the row it
 * names, and that row would come back on the next page.
 */
export const instantText = (column: PgColumn): SQL<string> =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The shape alone is not enough: `9999-99-99T99:99:99.000000Z` and 30 February both match it, and
 * Postgres refuses the `::timestamptz` cast (22008), which would answer a tampered cursor with a
 * 500. A real instant survives the round trip through `Date` at second precision; one that was
 * normalised (month 99, hour 24, 29 February in a common year) does not. The microseconds are
 * left to Postgres, which is why this compares only the first 19 characters.
 */
function isRealInstant(text: string): boolean {
  const date = new Date(text);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 19) === text.slice(0, 19);
}

const cursorSchema = z.object({
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    .refine(isRealInstant, 'not a real instant'),
  id: z.string().uuid(),
});

export type InstantCursor = z.infer<typeof cursorSchema>;

const SEPARATOR = '|';

export const encodeInstantCursor = (cursor: InstantCursor): string =>
  Buffer.from(`${cursor.occurredAt}${SEPARATOR}${cursor.id}`, 'utf8').toString('base64url');

/**
 * A cursor is client input however opaque it looks: it is parsed, and a malformed one is a
 * ZodError, which the exception filter answers as 400 VALIDATION_FAILED.
 */
export function decodeInstantCursor(raw: string): InstantCursor {
  const [occurredAt, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split(SEPARATOR);
  return cursorSchema.parse({ occurredAt, id: rest.length === 0 ? id : undefined });
}

/** The row-value comparison that continues a newest-first page strictly after the cursor. */
export const afterInstantCursor = (timestamp: PgColumn, id: PgColumn, cursor: InstantCursor): SQL =>
  sql`(${timestamp}, ${id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`;
