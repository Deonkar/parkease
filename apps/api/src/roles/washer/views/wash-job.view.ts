import type { CarwashJobEvent, CarwashJobStatus } from '@parkease/contracts/enums';
import { CARWASH_JOB_EVENT_VALUES } from '@parkease/contracts/enums';
import { computeWashFee } from '@parkease/contracts/money';
import { type Paise, toPaise, toRate } from '@parkease/contracts/primitives';
import {
  nextCarwashStatus,
  parseCarwashJobStatus,
  WASH_ACCEPT_TIMEOUT_MS,
  type WashJobOffer,
  washJobOfferSchema,
  type WashJobView,
  washJobViewSchema,
} from '@parkease/contracts/washer';

import type { WashJobRow } from '../../../domains/carwash/carwash.service.js';

/**
 * Events a partner may fire from here, derived from the machine rather than
 * from a switch the app and the server each keep a copy of.
 *
 * The same exclusions `advanceWashJobSchema` makes, for the same reasons, and
 * they must stay in step: an event listed here but rejected there is a button
 * the app renders and the server refuses.
 */
const WASHER_FIREABLE_EVENTS = CARWASH_JOB_EVENT_VALUES.filter(
  (event): event is CarwashJobEvent =>
    event !== 'cancel' && event !== 'offer' && event !== 'accept',
);

export function availableEventsFor(status: CarwashJobStatus): string[] {
  return WASHER_FIREABLE_EVENTS.filter((event) => nextCarwashStatus(status, event) !== null);
}

/**
 * What the partner keeps, or null when nobody has accepted yet.
 *
 * Derived from the *stored* price and the rate frozen on the row, never from
 * the partner's current menu: `price_paise` is what the driver is actually
 * charged, and a screen that re-reads the menu would show a partner a different
 * number after they edit their prices — for a job already on the books.
 *
 * `computeWashFee` rather than a local subtraction, because it is the function
 * the ledger posting used. A second rounding rule applied to the same two
 * numbers is a screen that quietly disagrees with the money by a paisa.
 */
function earningsFor(pricePaise: number | null, commissionRate: string): number | null {
  if (pricePaise === null) return null;
  return computeWashFee(toPaise(pricePaise), toRate(Number(commissionRate))).washerEarningsPaise;
}

export function toWashJobView(job: WashJobRow): WashJobView {
  return washJobViewSchema.parse({
    id: job.id,
    bookingId: job.bookingId,
    status: job.status,
    serviceName: job.serviceName,
    vehicleType: job.vehicleType,
    spaceLocation: job.spaceLocation,
    earningsPaise: earningsFor(job.pricePaise, job.commissionRate),
    availableEvents: availableEventsFor(parseCarwashJobStatus(job.status)),
    beforePhotoId: job.beforePhotoId,
    afterPhotoId: job.afterPhotoId,
    acceptedAt: job.acceptedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  });
}

/**
 * An open offer, as a card in the partner's app.
 *
 * `earningsPaise` is priced from **this partner's own menu**, passed in by the
 * caller rather than read off the job: the job has no price until somebody
 * accepts, and three partners looking at the same job may each be quoting a
 * different number. Showing them a job-level figure would be wrong for at least
 * two of the three.
 */
export function toWashJobOffer(row: {
  job: WashJobRow;
  distanceM: number;
  offeredAt: Date;
  pricePaise: number;
}): WashJobOffer {
  const fee = computeWashFee(toPaise(row.pricePaise), toRate(Number(row.job.commissionRate)));

  return washJobOfferSchema.parse({
    jobId: row.job.id,
    bookingId: row.job.bookingId,
    serviceName: row.job.serviceName,
    vehicleType: row.job.vehicleType,
    spaceLocation: row.job.spaceLocation,
    distanceM: row.distanceM,
    earningsPaise: fee.washerEarningsPaise satisfies Paise,
    offeredAt: row.offeredAt.toISOString(),
    // Derived from when the offer went out rather than stored, so the ladder
    // and the countdown cannot disagree: WASH_ACCEPT_TIMEOUT_MS is the same
    // constant the worker's timeout job is scheduled with.
    expiresAt: new Date(row.offeredAt.getTime() + WASH_ACCEPT_TIMEOUT_MS).toISOString(),
  });
}
