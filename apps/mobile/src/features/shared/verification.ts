/**
 * What a partner's verification status means, for every partner role.
 *
 * R-ARCH-07 applied to both halves of one function. The status → state mapping
 * is EXTRACTED because the call sites must change together: if a status is
 * added server-side, a valet and a washer have to stop accepting work on the
 * same day, and two copies of this switch is how one of them does not. The
 * banner COPY stays duplicated per role, because a valet uploads a driving
 * licence and a washer uploads an ID proof — those strings merely look alike.
 *
 * Pure and free of `react-native`, so the node test environment can reach it.
 */

import { verificationStatusSchema, type VerificationStatus } from '@parkease/contracts/enums';

import { assertNever } from '@/lib/assert-never';

/**
 * The contract's statuses, plus `unknown` for a value this build does not know
 * (I2). Typed from `VerificationStatus`, so a status added to the contract
 * fails typecheck at every exhaustive switch below instead of falling through.
 */
export type VerificationState = VerificationStatus | 'unknown';

export type BannerTone = 'info' | 'error';

export interface VerificationBanner {
  readonly tone: BannerTone;
  readonly title: string;
  readonly body: string;
  readonly action: string | null;
}

/**
 * A status off the wire, parsed through the contract's own schema (R-VAL-01).
 *
 * Fails closed. The client lock is only ever a courtesy — the server rejects
 * independently with 403 — but a client that guesses "probably fine" about an
 * unrecognised status is a client that puts an unapproved person on a job.
 * A washer's status is already typed by its contract; the valet job view still
 * carries it as a plain string (S-10), which is why this takes one.
 */
export function verificationStateFor(status: string): VerificationState {
  const parsed = verificationStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : 'unknown';
}

/** Only `verified` may take work. Exhaustive, so a new status must be decided here. */
export function canAcceptWork(state: VerificationState): boolean {
  switch (state) {
    case 'verified':
      return true;
    case 'pending':
    case 'unverified':
    case 'rejected':
    case 'unknown':
      return false;
    default:
      return assertNever(state);
  }
}
