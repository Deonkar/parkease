import { Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { logger } from '../../../platform/observability/logger.js';

import type { IstRange } from './account-totals.js';

/** The raw postgres.js client the app's single pool is built on; there is no second pool. */
export type SqlClient = Database['$client'];

export const LEDGER_CSV_HEADER = [
  'id',
  'txn_id',
  'occurred_at',
  'account',
  'direction',
  'amount_paise',
  'booking_id',
  'payout_id',
  'description',
] as const;

/** How many rows the driver fetches per round trip, and so the most that is ever held in memory. */
const CURSOR_BATCH_ROWS = 1000;

/** What a spreadsheet will execute as a formula when it opens the cell. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One CSV cell, safe to hand to a person's spreadsheet.
 *
 * A `description` can carry text somebody typed (a refund reason), and a cell beginning `=`, `+`,
 * `-`, `@`, TAB or CR is run as a formula by Excel and Sheets: that is CSV injection, and the
 * admin's own machine is the victim. The cell is neutralised with a leading `'`, then quoted if
 * the format needs it. Numbers are never text, so a negative amount stays a number.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);

  const text = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = (cells: readonly (string | number | null)[]): string =>
  `${cells.map(csvCell).join(',')}\r\n`;

interface ExportRow {
  readonly id: string;
  readonly txn_id: string;
  readonly occurred_at: string;
  readonly account: string;
  readonly direction: string;
  readonly amount_paise: string;
  readonly booking_id: string | null;
  readonly payout_id: string | null;
  readonly description: string;
}

/**
 * The ledger for a range as CSV text, a batch at a time. The header goes out before the query
 * runs, and each batch is joined and yielded as it arrives, so memory is one batch no matter how
 * long the ledger is: the response is never an array of rows.
 *
 * Amounts are integer paise (`amount_paise`), never rupees: a spreadsheet that divides by 100 does
 * so visibly. Oldest first, ties broken by id, so two exports of the same range are byte-identical.
 *
 * The stream is already flowing when a query fails, so the status line can no longer change. The
 * failure is logged with the trace id and rethrown, which destroys the response: a truncated file
 * that ends without a final newline is the signal, never a clean-looking short export.
 */
export async function* streamLedgerCsv(sql: SqlClient, range: IstRange): AsyncGenerator<string> {
  yield csvLine(LEDGER_CSV_HEADER);

  try {
    const rows = sql<ExportRow[]>`
      SELECT id,
             txn_id,
             to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
             account,
             direction,
             amount_paise::text AS amount_paise,
             booking_id,
             payout_id,
             description
      FROM ledger_entries
      WHERE occurred_at >= ${range.fromTs.toISOString()}::timestamptz
        AND occurred_at < ${range.toTs.toISOString()}::timestamptz
      ORDER BY occurred_at, id
    `.cursor(CURSOR_BATCH_ROWS);

    for await (const batch of rows) {
      yield batch
        .map((row) =>
          csvLine([
            row.id,
            row.txn_id,
            row.occurred_at,
            row.account,
            row.direction,
            row.amount_paise,
            row.booking_id,
            row.payout_id,
            row.description,
          ]),
        )
        .join('');
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        traceId: trace.getActiveSpan()?.spanContext().traceId ?? 'untraced',
        from: range.fromTs.toISOString(),
        to: range.toTs.toISOString(),
      },
      'the ledger export failed after the response had started',
    );
    throw error;
  }
}

/** The export's seam to Nest: hands the one shared client to the generator. */
@Injectable()
export class LedgerExportStream {
  constructor(@Inject(DB) private readonly db: Database) {}

  stream(range: IstRange): AsyncGenerator<string> {
    return streamLedgerCsv(this.db.$client, range);
  }
}
