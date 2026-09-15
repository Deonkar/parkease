import type { BookingStatus, CheckInMethod } from '@parkease/contracts/enums';
import type { OwnerCheckInResult } from '@parkease/contracts/owner';

export interface CheckedInBookingRow {
  readonly id: string;
  readonly status: string;
  readonly checkedInAt: Date | null;
  readonly checkInMethod: string | null;
  readonly vehicleNumber: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * What the scanner shows the moment a code resolves: who arrived, in what, and
 * for how long. No money — the owner's earnings live on their dashboard, and a
 * scan screen is not the place to put a number next to a stranger's face.
 *
 * `checkedInAt` and `checkInMethod` are non-null by construction here: the row
 * comes straight out of CheckInCommand's UPDATE, and the database's
 * `bookings_check_in_method_present_check` will not let one exist without the
 * other. The fallbacks exist so a shape change fails loudly in review rather
 * than silently rendering "Invalid Date".
 */
export function toOwnerCheckInView(
  row: CheckedInBookingRow,
  driverName: string,
): OwnerCheckInResult {
  return {
    id: row.id,
    status: row.status as BookingStatus,
    checkedInAt: (row.checkedInAt ?? new Date()).toISOString(),
    checkInMethod: (row.checkInMethod ?? 'owner_scan') as CheckInMethod,
    driverName,
    vehicleNumber: row.vehicleNumber,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  } as OwnerCheckInResult;
}
