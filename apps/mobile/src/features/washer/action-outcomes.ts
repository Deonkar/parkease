import { assertNever } from '@/lib/assert-never';
import { warn } from '@/lib/log';

import {
  IN_FLIGHT_COPY,
  OUTDATED_COPY,
  apiErrorCodeOf,
  classifyFailure,
  httpStatusOf,
  serverMessageOf,
} from './api/errors';

/**
 * What a failed Accept or a failed status change means for the screen: which
 * intent to keep, whether the offer card goes, and what the partner is told.
 *
 * Pure apart from its warn log, and free of `react-native`, so every branch is
 * a unit test rather than a wiring grep over a screen. The classification is
 * `api/errors.ts`'s (G1); this file only decides what each class means for
 * these two actions.
 */

/** §6 copy, and the server's own words for `WASH_JOB_TAKEN`. */
export const TAKEN_COPY = 'This job was taken by another partner. More jobs coming!';

const GONE_COPY = 'This job is no longer available. New offers will appear here.';
const ACCEPT_REFUSED = "We couldn't accept this job.";
const ACCEPT_UNREACHABLE =
  "Couldn't reach ParkEase. Check your connection, then press Accept again.";

const ADVANCE_REFUSED = "ParkEase didn't accept that step. Your job has been refreshed.";
const ADVANCE_UNREACHABLE = "Couldn't update the job. Check your connection and try again.";

/** Self-correcting: the refetch the refusal triggers shows the true status. */
const ILLEGAL_TRANSITION = 'ILLEGAL_CARWASH_TRANSITION';

export interface AcceptOutcome {
  /** Pressing Accept again should replay THIS attempt (R-FE-05). */
  readonly keepIntent: boolean;
  /** The offer can no longer be accepted, so it leaves the list now. */
  readonly removeCard: boolean;
  readonly notice: string;
}

/**
 * Only `WASH_JOB_TAKEN` and a 404 mean "no longer available". Every other
 * refusal (not verified, not onboarded, a service off the menu) keeps the card
 * and says the server's own words — the offer still exists, and the partner
 * may be one fix away from taking it.
 */
export function acceptOutcomeFor(error: unknown): AcceptOutcome {
  const kind = classifyFailure(error);
  const code = apiErrorCodeOf(error) ?? 'no code';
  warn(`washer.offers: accept failed (${kind}, ${code})`, error);

  switch (kind) {
    case 'refused': {
      if (code === 'WASH_JOB_TAKEN') {
        return { keepIntent: false, removeCard: true, notice: TAKEN_COPY };
      }
      if (httpStatusOf(error) === 404)
        return { keepIntent: false, removeCard: true, notice: GONE_COPY };
      return {
        keepIntent: false,
        removeCard: false,
        notice: serverMessageOf(error) ?? ACCEPT_REFUSED,
      };
    }
    case 'outdated':
      return { keepIntent: false, removeCard: false, notice: OUTDATED_COPY };
    case 'in-flight':
      return { keepIntent: true, removeCard: false, notice: IN_FLIGHT_COPY };
    case 'unreachable':
      return { keepIntent: true, removeCard: false, notice: ACCEPT_UNREACHABLE };
    default:
      return assertNever(kind);
  }
}

export interface AdvanceOutcome {
  readonly keepIntent: boolean;
  /** `null` only where the screen corrects itself and words would be noise. */
  readonly notice: string | null;
}

/**
 * A refused step is TOLD (G2): the photo gate the pair got wrong, a job that
 * is no longer this partner's. Only an illegal transition stays quiet, because
 * the refetch that follows shows the true status and there is nothing to do.
 */
export function advanceOutcomeFor(error: unknown): AdvanceOutcome {
  const kind = classifyFailure(error);
  const code = apiErrorCodeOf(error) ?? 'no code';
  warn(`washer.active: status change failed (${kind}, ${code})`, error);

  switch (kind) {
    case 'refused':
      if (code === ILLEGAL_TRANSITION) return { keepIntent: false, notice: null };
      return { keepIntent: false, notice: serverMessageOf(error) ?? ADVANCE_REFUSED };
    case 'outdated':
      return { keepIntent: false, notice: OUTDATED_COPY };
    case 'in-flight':
      return { keepIntent: true, notice: IN_FLIGHT_COPY };
    case 'unreachable':
      return { keepIntent: true, notice: ADVANCE_UNREACHABLE };
    default:
      return assertNever(kind);
  }
}
