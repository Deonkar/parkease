import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { type BookingStatus, type DurationType, LedgerAccount } from '@parkease/contracts/enums';
import { bookings, ledgerEntries, spaces, users } from '@parkease/db/schema';
import { and, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { DB, type Database } from '../../../platform/db/db.module.js';
import { signedBalancePaise } from '../accounts.js';
import { type EarningsPeriod, istDays, periodBound } from '../period-bound.js';

export type Reader = Pick<Database, 'select'>;

export interface Movement {
  readonly creditsPaise: number;
  readonly debitsPaise: number;
  readonly netPaise: number;
}

export interface StatementRow {
  readonly bookingId: string;
  readonly occurredAt: Date;
  readonly driverName: string | null;
  readonly spaceName: string;
  readonly durationType: DurationType;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly basePaise: number;
  readonly feePaise: number;
  readonly reversedPaise: number;
  readonly netPaise: number;
}

const CREDITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
  filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`;
const DEBITS = sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
  filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`;

/** Never paid: the receivable was reversed to zero, so there is nothing to show a line for. */
const UNPAID: BookingStatus[] = ['pending_payment', 'expired'];

const net = (debits: number, credits: number) =>
  signedBalancePaise(LedgerAccount.OWNER_PAYABLE, debits, credits);

const cursorSchema = z.object({ t: z.string().datetime(), i: z.string().uuid() });

const encodeCursor = (row: StatementRow) =>
  Buffer.from(JSON.stringify({ t: row.occurredAt.toISOString(), i: row.bookingId })).toString(
    'base64url',
  );

function decodeCursor(raw: string): { at: string; id: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Malformed base64url or JSON: a typed failure, answered as 400 below.
    return undefined;
  }
  const payload = cursorSchema.safeParse(parsed);
  return payload.success ? { at: payload.data.t, id: payload.data.i } : undefined;
}

/**
 * What an owner is owed, answered from the ledger and from nothing else.
 *
 * Never recomputed from `bookings`: ADR-008 makes the ledger authoritative for
 * every question of the form "how much does X earn / owe / get back", and the
 * moment a second module starts deriving earnings from booking rows the two
 * begin to disagree — which is precisely what happened in v1, across three
 * modules that each did their own arithmetic.
 *
 * A promotional campaign is invisible here by construction. A discount is funded
 * from `promo_expense` and never touches `owner_payable` (R-MONEY-05), so a free
 * booking credits the owner exactly what a paid one would.
 *
 * Task 15 (owner dashboard) added the period reads below: `movement`, `days`,
 * `statementCount`, `statementPage` and `netByBooking`. All of them take an
 * optional `reader` so a caller building a consistent snapshot across several
 * of these calls can pass a transaction handle instead of `this.db`.
 */
@Injectable()
export class OwnerBalanceQuery {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Signed paise: positive means we owe the owner.
   *
   * `owner_payable` is a liability, so the sign comes from the chart rather than
   * from a subtraction written the way it happened to read at the call site.
   */
  async forOwner(ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({
        debitsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
        creditsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
      })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(
        and(eq(spaces.ownerId, ownerId), eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE)),
      );

    return signedBalancePaise(
      LedgerAccount.OWNER_PAYABLE,
      Number(row?.debitsPaise ?? 0),
      Number(row?.creditsPaise ?? 0),
    );
  }

  /** The same question scoped to one booking, for a statement line. */
  async forBooking(bookingId: string): Promise<number> {
    const [row] = await this.db
      .select({
        debitsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'debit'), 0)::text`,
        creditsPaise: sql<string>`coalesce(sum(${ledgerEntries.amountPaise})
          filter (where ${ledgerEntries.direction} = 'credit'), 0)::text`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.bookingId, bookingId),
          eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE),
        ),
      );

    return signedBalancePaise(
      LedgerAccount.OWNER_PAYABLE,
      Number(row?.debitsPaise ?? 0),
      Number(row?.creditsPaise ?? 0),
    );
  }

  private ownerScope(ownerId: string) {
    return and(eq(spaces.ownerId, ownerId), eq(ledgerEntries.account, LedgerAccount.OWNER_PAYABLE));
  }

  /**
   * `movement` scoped to a named period, so a caller in `roles/` never needs
   * `ledgerEntries.occurredAt` itself — that column is a `@parkease/db` import,
   * and ADR-016 keeps the database out of `roles/` entirely.
   */
  async movementForPeriod(
    ownerId: string,
    period: EarningsPeriod,
    reader: Reader = this.db,
  ): Promise<Movement> {
    return this.movement(ownerId, periodBound(ledgerEntries.occurredAt, period), reader);
  }

  /** Ledger movement on the owner's `owner_payable` inside `bound` (undefined = all time). */
  async movement(
    ownerId: string,
    bound: SQL | undefined,
    reader: Reader = this.db,
  ): Promise<Movement> {
    const [row] = await reader
      .select({ creditsPaise: CREDITS, debitsPaise: DEBITS })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(and(this.ownerScope(ownerId), bound));

    const creditsPaise = Number(row?.creditsPaise ?? 0);
    const debitsPaise = Number(row?.debitsPaise ?? 0);
    return { creditsPaise, debitsPaise, netPaise: net(debitsPaise, creditsPaise) };
  }

  /** One bucket per IST day of the period, zero-filled, oldest first. */
  async days(ownerId: string, period: 'today' | 'week' | 'month', reader: Reader = this.db) {
    const day = sql<string>`to_char((${ledgerEntries.occurredAt} AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD')`;
    const rows = await reader
      .select({ day, creditsPaise: CREDITS, debitsPaise: DEBITS })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(and(this.ownerScope(ownerId), periodBound(ledgerEntries.occurredAt, period)))
      .groupBy(day);

    const moved = new Map(
      rows.map((r) => [r.day, net(Number(r.debitsPaise), Number(r.creditsPaise))]),
    );
    // Union with the posted days: a request straddling IST midnight must not
    // drop a bucket the database already counted in the period total.
    const dates = [...new Set([...istDays(period), ...moved.keys()])].sort();
    return dates.map((date) => ({ date, netPaise: moved.get(date) ?? 0 }));
  }

  private statementQuery(ownerId: string, reader: Reader) {
    const firstCredit = sql`min(${ledgerEntries.occurredAt})`.mapWith(ledgerEntries.occurredAt);
    const query = reader
      .select({
        bookingId: bookings.id,
        occurredAt: firstCredit,
        driverName: users.name,
        spaceName: spaces.title,
        durationType: bookings.durationType,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        basePaise: bookings.basePaise,
        creditsPaise: CREDITS,
        debitsPaise: DEBITS,
      })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .innerJoin(users, eq(users.id, bookings.driverId))
      .where(and(this.ownerScope(ownerId), notInArray(bookings.status, UNPAID)))
      .groupBy(bookings.id, spaces.id, users.id);
    return { query, firstCredit };
  }

  async statementCount(ownerId: string, period: EarningsPeriod, reader: Reader = this.db) {
    const { query, firstCredit } = this.statementQuery(ownerId, reader);
    const rows = await query.having(periodBound(firstCredit, period));
    return rows.length;
  }

  /**
   * One line per booking, newest first by its first credit. Fee is
   * `base − credits`: base as pricing recorded it (R-ARCH-06), credits as the
   * ledger holds them. `platform_revenue` cannot answer this — it carries 15%
   * of base and all surge in one row (ADR-009).
   */
  async statementPage(
    ownerId: string,
    opts: { period: EarningsPeriod; limit: number; cursor?: string },
    reader: Reader = this.db,
  ) {
    const cursor = opts.cursor === undefined ? undefined : decodeCursor(opts.cursor);
    if (opts.cursor !== undefined && cursor === undefined) {
      throw new BadRequestException({
        error: 'INVALID_CURSOR',
        message: 'That page link is no longer valid. Pull to refresh.',
      });
    }

    const { query, firstCredit } = this.statementQuery(ownerId, reader);
    const rows = await query
      .having(
        and(
          periodBound(firstCredit, opts.period),
          cursor === undefined
            ? undefined
            : sql`(min(${ledgerEntries.occurredAt}), ${bookings.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`,
        ),
      )
      .orderBy(desc(firstCredit), desc(bookings.id))
      .limit(opts.limit + 1);

    const hasMore = rows.length > opts.limit;
    const items: StatementRow[] = rows.slice(0, opts.limit).map((row) => {
      const creditsPaise = Number(row.creditsPaise);
      const debitsPaise = Number(row.debitsPaise);
      return {
        bookingId: row.bookingId,
        occurredAt: row.occurredAt,
        driverName: row.driverName,
        spaceName: row.spaceName,
        durationType: row.durationType,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        basePaise: row.basePaise,
        feePaise: row.basePaise - creditsPaise,
        reversedPaise: debitsPaise,
        netPaise: net(debitsPaise, creditsPaise),
      };
    });
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
    };
  }

  /**
   * Net per booking, for the bookings list's "earned" line. Scoped with
   * `ownerScope` like every other read here — a caller that passes another
   * owner's booking ids gets nothing back for them, not that owner's money.
   */
  async netByBooking(ownerId: string, bookingIds: readonly string[], reader: Reader = this.db) {
    if (bookingIds.length === 0) return new Map<string, number>();
    const rows = await reader
      .select({ bookingId: ledgerEntries.bookingId, creditsPaise: CREDITS, debitsPaise: DEBITS })
      .from(ledgerEntries)
      .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .where(and(this.ownerScope(ownerId), inArray(ledgerEntries.bookingId, [...bookingIds])))
      .groupBy(ledgerEntries.bookingId);
    return new Map(
      rows.map((r) => [r.bookingId ?? '', net(Number(r.debitsPaise), Number(r.creditsPaise))]),
    );
  }
}
