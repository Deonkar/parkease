import type { ValetJobEvent, ValetJobStatus } from '@parkease/contracts/enums';
import { VALET_JOB_EVENT_VALUES } from '@parkease/contracts/enums';
import { computeValetLegFee } from '@parkease/contracts/money';
import { mulRate, subPaise, toPaise, toRate } from '@parkease/contracts/primitives';
import {
  ACCEPT_TIMEOUT_MS,
  nextValetStatus,
  parseValetJobStatus,
  type ValetJobView,
  valetJobViewSchema,
  type ValetOffer,
  valetOfferSchema,
} from '@parkease/contracts/valet';

import type { ValetJobRow } from '../../../domains/valet/valet.service.js';

/**
 * Events a valet may fire from here, derived from the machine rather than from a
 * switch the app and the server each maintain a copy of.
 *
 * The same exclusions `advanceValetJobSchema` makes, for the same reasons, and
 * they must stay in step: an event listed here but rejected there is a button
 * the app renders and the server refuses.
 */
const VALET_FIREABLE_EVENTS = VALET_JOB_EVENT_VALUES.filter(
  (event): event is ValetJobEvent =>
    event !== 'cancel' &&
    event !== 'no_show' &&
    event !== 'offer' &&
    event !== 'accept' &&
    event !== 'request_return',
);

export function availableEventsFor(status: ValetJobStatus): string[] {
  return VALET_FIREABLE_EVENTS.filter((event) => nextValetStatus(status, event) !== null);
}

/**
 * Paise the valet keeps for a leg, or null when the leg has not been priced.
 *
 * Derived from the *stored* fee and the rate frozen on the row, never recomputed
 * from a distance: `fee_paise` is what the driver was actually charged, and a
 * view that re-derives it from coordinates can disagree with the ledger.
 *
 * `mulRate` rather than `Math.round(fee * rate)` for the same reason — it is the
 * function the posting used, and a second rounding rule applied to the same two
 * numbers is a screen that quietly disagrees with the money by a paisa.
 */
function earningsFor(feePaise: number | null, commissionRate: string): number | null {
  if (feePaise === null) return null;
  const fee = toPaise(feePaise);
  return subPaise(fee, mulRate(fee, toRate(Number(commissionRate))));
}

export function toValetJobView(job: ValetJobRow): ValetJobView {
  return valetJobViewSchema.parse({
    id: job.id,
    bookingId: job.bookingId,
    status: job.status,
    pickupAddress: job.pickupAddress,
    pickupLocation: job.pickupLocation,
    returnDropLocation: job.returnDropLocation,
    distanceM: job.distanceM,
    earningsPaise: earningsFor(job.feePaise, job.commissionRate),
    returnEarningsPaise: earningsFor(job.returnFeePaise, job.commissionRate),
    availableEvents: availableEventsFor(parseValetJobStatus(job.status)),
    proofPhotoId: job.proofPhotoId,
    acceptedAt: job.acceptedAt?.toISOString() ?? null,
    arrivedAt: job.arrivedAt?.toISOString() ?? null,
    parkedAt: job.parkedAt?.toISOString() ?? null,
  });
}

export interface OfferRow {
  readonly job: ValetJobRow;
  readonly distanceM: number;
  readonly offeredAt: Date;
}

/**
 * An open offer as the valet app lists it.
 *
 * `earningsPaise` is what the valet takes home, not the fee and not the driver's
 * total: a partner deciding whether a job is worth driving to needs the number
 * that lands in their account, and showing the gross would overstate every card.
 */
export function toValetOffer(row: OfferRow): ValetOffer {
  const fee = computeValetLegFee(row.distanceM, toRate(Number(row.job.commissionRate)));

  return valetOfferSchema.parse({
    jobId: row.job.id,
    bookingId: row.job.bookingId,
    pickupAddress: row.job.pickupAddress,
    pickupLocation: row.job.pickupLocation,
    distanceM: Math.round(row.distanceM),
    earningsPaise: fee.valetEarningsPaise,
    offeredAt: row.offeredAt.toISOString(),
    expiresAt: new Date(row.offeredAt.getTime() + ACCEPT_TIMEOUT_MS).toISOString(),
  });
}
