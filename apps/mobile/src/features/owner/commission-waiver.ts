import type { OwnerDashboard } from '@parkease/contracts/owner';

import { formatDayMonthIST } from '@/lib/format';

type Waiver = OwnerDashboard['commissionWaiver'];

/** The server's IST date, formatted only — never computed here (R-FE-06). */
const until = (waiver: NonNullable<Waiver>): string =>
  formatDayMonthIST(new Date(`${waiver.endsOn}T00:00:00+05:30`));

/** The dashboard row for one of the first 50 owners (task 16c); null outside the window. */
export const waiverRow = (waiver: Waiver): string | null =>
  waiver === null
    ? null
    : `Commission-free until ${until(waiver)} · you keep the full price of every booking.`;

/**
 * The earnings subtitle: while commission-free there is no "ParkEase fee" to be after. While the
 * dashboard has not answered (`undefined`), it claims neither — stating a fee a commission-free
 * owner is not paying would be a wrong answer shown as a right one.
 */
export const earningsSubtitle = (waiver: Waiver | undefined): string =>
  waiver === undefined
    ? 'Your share of every booking'
    : waiver === null
      ? 'Your share, after the ParkEase fee'
      : `You keep the full price until ${until(waiver)}`;
