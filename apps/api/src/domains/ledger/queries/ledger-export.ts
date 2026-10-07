import { Readable } from 'node:stream';

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { trace } from '@opentelemetry/api';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import { AuditService, type AdminActor } from '../../../platform/observability/audit.service.js';
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

  // The pool's statement_timeout (30s) counts a cursor's whole life, slow reader included, so an
  // export on a pooled connection would be cancelled mid-file. It gets a connection of its own with
  // a timeout matching its deadline, reset before the connection goes back to the pool.
  const conn = await sql.reserve();
  try {
    await conn.unsafe(`SET statement_timeout = ${String(EXPORT_DEADLINE_MS + 30_000)}`);
    yield* exportRows(conn, range);
  } finally {
    await conn.unsafe('RESET statement_timeout').catch((error: unknown) => {
      logger.warn({ err: error }, 'ledger export could not reset its statement_timeout');
    });
    conn.release();
  }
}

async function* exportRows(
  sql: Awaited<ReturnType<SqlClient['reserve']>>,
  range: IstRange,
): AsyncGenerator<string> {
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
  private active = 0;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Each export holds one pooled connection for as long as the client reads (S-141). So at most
   * MAX_CONCURRENT_EXPORTS run at once, a stalled one is destroyed at the deadline (which returns
   * the generator, closing its cursor and its connection), and every export is audited before the
   * first byte — who pulled the whole ledger, for which range, from where.
   */
  async open(
    range: IstRange,
    label: { from: string; to: string },
    actor: AdminActor,
  ): Promise<Readable> {
    if (this.active >= MAX_CONCURRENT_EXPORTS) throw new ExportBusyError();
    await withTransaction(this.db, (tx) =>
      this.audit.record(tx, {
        actorUserId: actor.userId,
        actorRole: 'admin',
        action: 'ledger.export',
        targetType: 'ledger',
        targetId: null,
        after: label,
        ipAddress: actor.ipAddress,
      }),
    );

    this.active += 1;
    const stream = Readable.from(streamLedgerCsv(this.db.$client, range), { objectMode: false });
    const deadline = setTimeout(() => {
      logger.warn(
        { ...label, actor: actor.userId },
        'ledger export hit its deadline; destroying it',
      );
      stream.destroy(new Error('ledger export exceeded its deadline'));
    }, EXPORT_DEADLINE_MS);
    stream.once('close', () => {
      clearTimeout(deadline);
      this.active -= 1;
    });
    return stream;
  }
}

export const MAX_CONCURRENT_EXPORTS = 2;
/** Long enough for a year's ledger on a slow link; short enough that a stalled client lets go. */
export const EXPORT_DEADLINE_MS = 5 * 60_000;

export class ExportBusyError extends HttpException {
  constructor() {
    super(
      { error: 'EXPORT_BUSY', message: 'Two exports are already running. Try again in a minute.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
