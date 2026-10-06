import { Inject, Injectable } from '@nestjs/common';
import {
  type adminBookingDetailSchema,
  type adminBookingListItemSchema,
  type AdminBookingsQuery,
} from '@parkease/contracts/admin';
import {
  bookingStatusSchema,
  ledgerAccountSchema,
  ledgerDirectionSchema,
  paymentStatusSchema,
  refundStatusSchema,
} from '@parkease/contracts/enums';
import { maskPhone, type Paise, toPaise } from '@parkease/contracts/primitives';
import { bookings, ledgerEntries, payments, refunds, spaces, users } from '@parkease/db/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { DB, type Database } from '../../platform/db/db.module.js';
import {
  CAPTURED_PAYMENT_STATUSES,
  ORPHAN_CAPTURE_REFUND_REASON,
} from '../payment/payment.service.js';
import { isAdminRefundable, refundableOf, refundOptions } from '../payment/refund-options.js';

/**
 * What the queries hand the controller: the contract's input shape. Enum columns are TEXT + CHECK,
 * so they are parsed here, never cast (R-VAL-01); brands and datetimes are applied by
 * `parseOutgoing` on the way out, so a row that drifted from the contract is a 500 with the field
 * named rather than a response that lies.
 */
type ListItemView = z.input<typeof adminBookingListItemSchema>;
type DetailView = z.input<typeof adminBookingDetailSchema>;

const owners = alias(users, 'owners');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Backslash, `%` and `_` mean something to LIKE; an admin typing `50%` means the characters. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/** A booking id finds that booking; anything else searches driver name and space title. */
function searchBy(text: string): SQL | undefined {
  if (UUID.test(text)) return eq(bookings.id, text);
  return or(ilike(users.name, likePattern(text)), ilike(spaces.title, likePattern(text)));
}

/**
 * `from`/`to` are IST calendar days over `starts_at`, both inclusive: `to` runs until the next IST
 * midnight. The day boundary is computed by Postgres in Asia/Kolkata, never in the server's zone.
 */
const startsOnOrAfter = (day: string): SQL =>
  sql`${bookings.startsAt} >= (${day}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
const startsOnOrBefore = (day: string): SQL =>
  sql`${bookings.startsAt} < ((${day}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')`;

/**
 * The admin booking screens (task 18a). The driver's phone is masked here, before a row leaves
 * the domain, so no caller can forget to.
 */
@Injectable()
export class AdminBookingQueries {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(q: AdminBookingsQuery): Promise<{ items: ListItemView[]; total: number }> {
    const where = and(
      isNull(bookings.deletedAt),
      q.status === undefined ? undefined : eq(bookings.status, q.status),
      q.q === undefined || q.q === '' ? undefined : searchBy(q.q),
      q.from === undefined ? undefined : startsOnOrAfter(q.from),
      q.to === undefined ? undefined : startsOnOrBefore(q.to),
    );

    const base = () =>
      this.db
        .select({
          id: bookings.id,
          status: bookings.status,
          driverName: users.name,
          spaceTitle: spaces.title,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          totalPaise: bookings.totalPaise,
        })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.driverId))
        .innerJoin(spaces, eq(spaces.id, bookings.spaceId));

    const [rows, [count]] = await Promise.all([
      base()
        .where(where)
        .orderBy(desc(bookings.startsAt), desc(bookings.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.driverId))
        .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({
        ...row,
        status: bookingStatusSchema.parse(row.status),
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      })),
      total: count?.total ?? 0,
    };
  }

  /**
   * One booking with its money: every ledger row it produced, its parking payments and their
   * refunds, and what an admin may still refund.
   *
   * The refundable balance is computed by the same rules `AdminRefundCommand` applies under its
   * lock — the same payment (`CAPTURED_PAYMENT_STATUSES`, not orphan-refunded, newest capture) and
   * `refundableOf` — so
   * the options shown are the options that will be honoured. A live booking still shows its
   * balance but no options: cancelling is how it is refunded (`isAdminRefundable`).
   */
  async detail(bookingId: string): Promise<DetailView | undefined> {
    const [row] = await this.db
      .select({
        booking: bookings,
        driverName: users.name,
        driverPhone: users.phone,
        spaceTitle: spaces.title,
        ownerName: owners.name,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.driverId))
      .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
      .leftJoin(owners, eq(owners.id, spaces.ownerId))
      .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)));
    if (row === undefined) return undefined;
    const { booking } = row;

    const paymentRows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, booking.id), eq(payments.purpose, 'booking')))
      .orderBy(asc(payments.createdAt), asc(payments.id));
    const paymentIds = paymentRows.map((p) => p.id);

    const [refundRows, ledgerRows] = await Promise.all([
      paymentIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select()
            .from(refunds)
            .where(inArray(refunds.paymentId, paymentIds))
            .orderBy(asc(refunds.createdAt), asc(refunds.id)),
      this.db
        .select()
        .from(ledgerEntries)
        .where(
          paymentIds.length === 0
            ? eq(ledgerEntries.bookingId, booking.id)
            : or(
                eq(ledgerEntries.bookingId, booking.id),
                inArray(ledgerEntries.paymentId, paymentIds),
              ),
        )
        .orderBy(asc(ledgerEntries.occurredAt), asc(ledgerEntries.id)),
    ]);

    const refundable = paymentRows
      .filter(
        (p) =>
          CAPTURED_PAYMENT_STATUSES.some((s) => s === p.status) &&
          p.razorpayPaymentId !== null &&
          p.capturedPaise !== null &&
          !refundRows.some(
            (r) => r.paymentId === p.id && r.reason === ORPHAN_CAPTURE_REFUND_REASON,
          ),
      )
      .sort((a, b) => (b.capturedAt?.getTime() ?? 0) - (a.capturedAt?.getTime() ?? 0))[0];
    const refundablePaise: Paise =
      refundable === undefined || refundable.capturedPaise === null
        ? toPaise(0)
        : refundableOf(
            refundable.capturedPaise,
            refundRows.filter((r) => r.paymentId === refundable.id),
          );

    return {
      id: booking.id,
      status: bookingStatusSchema.parse(booking.status),
      driver: { id: booking.driverId, name: row.driverName, phone: maskPhone(row.driverPhone) },
      space: { id: booking.spaceId, title: row.spaceTitle, ownerName: row.ownerName },
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      totalPaise: booking.totalPaise,
      ownerEarningsPaise: booking.ownerEarningsPaise,
      parkeaseFeePaise: booking.parkeaseFeePaise,
      gstPaise: booking.gstPaise,
      ledger: ledgerRows.map((e) => ({
        id: e.id,
        txnId: e.txnId,
        account: ledgerAccountSchema.parse(e.account),
        direction: ledgerDirectionSchema.parse(e.direction),
        amountPaise: e.amountPaise,
        bookingId: e.bookingId,
        payoutId: e.payoutId,
        description: e.description,
        occurredAt: e.occurredAt.toISOString(),
      })),
      payments: paymentRows.map((p) => ({
        id: p.id,
        status: paymentStatusSchema.parse(p.status),
        amountPaise: p.capturedPaise ?? p.expectedTotalPaise,
        razorpayPaymentId: p.razorpayPaymentId,
      })),
      refunds: refundRows.map((r) => ({
        id: r.id,
        amountPaise: r.amountPaise,
        status: refundStatusSchema.parse(r.status),
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
      refundablePaise,
      refundOptions: isAdminRefundable(booking.status) ? [...refundOptions(refundablePaise)] : [],
    };
  }
}
