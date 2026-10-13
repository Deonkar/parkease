import type { DriverValetJob, DriverWashJob } from '@parkease/contracts/driver';
import type { CarwashJobStatus, ValetJobStatus } from '@parkease/contracts/enums';
import { isTerminalValetStatus, nextValetStatus } from '@parkease/contracts/valet';

/**
 * What each add-on status means to the driver, in words.
 *
 * `Record` over the contract's unions, so a new status fails typecheck here
 * until it can be explained — a status the screen cannot name is a status the
 * driver reads as "stuck".
 */
export interface StatusCopy {
  /** Short: the chip on the booking card. */
  readonly label: string;
  /** One sentence: what is happening and what, if anything, the driver does. */
  readonly detail: string;
}

export const VALET_STATUS_COPY: Readonly<Record<ValetJobStatus, StatusCopy>> = {
  requested: {
    label: 'Finding a valet',
    detail: 'We are asking valets near you. This usually takes a minute or two.',
  },
  offered: {
    label: 'Finding a valet',
    detail: 'We are asking valets near you. This usually takes a minute or two.',
  },
  accepted: {
    label: 'Valet assigned',
    detail: 'Your valet has taken the job and is getting ready to come to you.',
  },
  en_route: {
    label: 'On the way',
    detail: 'Your valet is on the way to your pickup point.',
  },
  arrived: {
    label: 'Valet arrived',
    detail: 'Your valet is at the pickup point. Hand over the keys when you meet.',
  },
  parking: {
    label: 'Parking your car',
    detail: 'Your valet has your car and is driving it to the space.',
  },
  parked: {
    label: 'Parked',
    detail: 'Your car is parked. Ask for it back when you are ready.',
  },
  return_requested: {
    label: 'Return requested',
    detail: 'Your valet is heading back to your car.',
  },
  returning: {
    label: 'Bringing it back',
    detail: 'Your valet is driving your car to the drop-off point.',
  },
  completed: { label: 'Done', detail: 'Your car has been handed back.' },
  cancelled: { label: 'Cancelled', detail: 'This valet request was cancelled.' },
  no_show: {
    label: 'Missed pickup',
    detail: 'The valet could not meet you at the pickup point.',
  },
};

export const WASH_STATUS_COPY: Readonly<Record<CarwashJobStatus, StatusCopy>> = {
  requested: {
    label: 'Finding a washer',
    detail: 'We are asking wash partners near your space.',
  },
  offered: {
    label: 'Finding a washer',
    detail: 'We are asking wash partners near your space.',
  },
  accepted: {
    label: 'Washer assigned',
    detail: 'A partner has taken the job. Pay now so they can start.',
  },
  en_route: {
    label: 'On the way',
    detail: 'Your wash partner is on the way to your car.',
  },
  washing: { label: 'Washing', detail: 'Your car is being washed.' },
  completed: { label: 'Done', detail: 'Your wash is finished.' },
  cancelled: { label: 'Cancelled', detail: 'This wash was cancelled.' },
};

/**
 * Whether the screen should keep asking for news. A terminal job does not move
 * again, so polling it is traffic for nothing.
 */
export const valetIsLive = (job: DriverValetJob): boolean => !isTerminalValetStatus(job.status);

export const washIsLive = (job: DriverWashJob): boolean =>
  job.status !== 'completed' && job.status !== 'cancelled';

/**
 * "Bring my car back" exists only where the state machine accepts it — the same
 * table the server asserts against, so the button and the refusal cannot drift.
 */
export const canRequestReturn = (job: DriverValetJob): boolean =>
  nextValetStatus(job.status, 'request_return') !== null;

/**
 * Pay exists once a partner has frozen a price on the job and before the job is
 * over. `paid` is what this device remembers of a Checkout that succeeded: the
 * driver wash view does not report payment state.
 */
export const canPayForWash = (job: DriverWashJob, paid: boolean): boolean =>
  !paid && job.driverTotalPaise !== null && washIsLive(job);

/**
 * The booking statuses each add-on can be requested from, mirroring the API's
 * own eligibility lists so the button never offers what the server refuses.
 *
 * A valet can be booked before arrival — that is the point of one. A wash needs
 * the car physically in the space.
 */
export const VALET_BOOKING_STATUSES = ['confirmed', 'active'] as const;
export const WASH_BOOKING_STATUSES = ['active'] as const;

/**
 * A partner's rating in words. `ratingAvgBp` is stars in basis points (42_000
 * is 4.2), and an unrated partner is "New" rather than a zero they did not earn.
 */
export function formatPartnerRating(ratingAvgBp: number | null, ratingCount: number): string {
  if (ratingAvgBp === null || ratingCount === 0) return 'New';
  return `${(ratingAvgBp / 10_000).toFixed(1)} ★ (${String(ratingCount)})`;
}
