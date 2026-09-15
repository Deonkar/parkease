import type { DriverBooking, QuoteBreakdown } from '@parkease/contracts/driver';
import type { CheckInMethod, DurationType, VehicleType } from '@parkease/contracts/enums';
import type { BookingStatus } from '@parkease/contracts/enums';

import { PAYMENT_WINDOW_MS } from '../../../domains/booking/commands/create-booking.command.js';
import { signBookingReference } from '../../../domains/booking/qr.js';

export interface BookingRow {
  readonly id: string;
  readonly status: string;
  readonly vehicleType: string;
  readonly vehicleNumber: string | null;
  readonly durationType: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly basePaise: number;
  readonly surgePremiumPaise: number;
  readonly surgeMultiplierBp: number;
  readonly gstPaise: number;
  readonly totalPaise: number;
  readonly ownerEarningsPaise: number;
  readonly checkedInAt: Date | null;
  readonly checkInMethod: string | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly createdAt: Date;
}

export interface SpaceRow {
  readonly id: string;
  readonly title: string;
  readonly addressLine: string;
  readonly landmark: string | null;
  readonly location: { lat: number; lng: number };
  readonly accessInstructions: string | null;
}

/**
 * The breakdown the driver is shown. There is deliberately no `parkeaseFeePaise`
 * field on the contract: the ParkEase Fee is charged once, out of the owner's
 * side, and a driver-side fee row would charge it twice — exactly the bug the
 * corrected model exists to remove (ADR-009, website.md §2.7).
 */
const toQuoteBreakdown = (row: BookingRow): QuoteBreakdown =>
  ({
    basePaise: row.basePaise,
    surgePremiumPaise: row.surgePremiumPaise,
    gstPaise: row.gstPaise,
    totalPaise: row.totalPaise,
    ownerEarningsPaise: row.ownerEarningsPaise,
    surgeMultiplierBp: row.surgeMultiplierBp,
  }) as QuoteBreakdown;

/**
 * The QR is issued only while a scan could still do something — `confirmed` is
 * the one status `check_in` is legal from. Handing out a token for a completed
 * or cancelled booking would put a signed, still-valid reference on a screen
 * that has no business showing one.
 */
/**
 * Statuses at which the driver has actually earned entry details. A
 * pending_payment hold has not: the slot is reserved, nothing is paid, and the
 * expiry job may take it back in ten minutes.
 */
const RELEASES_ACCESS = new Set(['confirmed', 'active', 'completed']);

const qrTokenFor = (row: BookingRow, secret: string, now: Date): string | null =>
  row.status === 'confirmed' ? signBookingReference(row.id, secret, now) : null;

export function toDriverBookingView(
  row: BookingRow,
  space: SpaceRow,
  slotIndex: number | null,
  qrSecret: string,
  now: Date = new Date(),
): DriverBooking {
  return {
    id: row.id,
    status: row.status as BookingStatus,
    space: {
      id: space.id,
      title: space.title,
      addressLine: space.addressLine,
      landmark: space.landmark,
      latitude: space.location.lat,
      longitude: space.location.lng,
      // Released only once the booking is real, for the same reason the QR is.
      // A pending_payment hold has not bought anyone the gate code — the slot is
      // reserved, nothing is paid, and the expiry job may take it back.
      accessInstructions: RELEASES_ACCESS.has(row.status) ? space.accessInstructions : null,
    },
    vehicleType: row.vehicleType as VehicleType,
    vehicleNumber: row.vehicleNumber,
    durationType: row.durationType as DurationType,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    slotIndex,
    quote: toQuoteBreakdown(row),
    qrToken: qrTokenFor(row, qrSecret, now),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    checkInMethod: (row.checkInMethod as CheckInMethod | null) ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    // Presentational only. The expiry job owns the deadline; this is what the
    // countdown on Review & Pay ticks down to (R-FE-06).
    paymentDeadlineAt:
      row.status === 'pending_payment'
        ? new Date(row.createdAt.getTime() + PAYMENT_WINDOW_MS).toISOString()
        : null,
    createdAt: row.createdAt.toISOString(),
  } as DriverBooking;
}
