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

export type VerificationState = 'verified' | 'pending' | 'unverified' | 'rejected' | 'unknown';

export type BannerTone = 'info' | 'error';

export interface VerificationBanner {
  readonly tone: BannerTone;
  readonly title: string;
  readonly body: string;
  readonly action: string | null;
}

/**
 * Fails closed. The client lock is only ever a courtesy — the server rejects
 * independently with 403 — but a client that guesses "probably fine" about an
 * unrecognised status is a client that puts an unapproved person on a job.
 */
export function verificationStateFor(status: string): VerificationState {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'pending':
      return 'pending';
    case 'unverified':
      return 'unverified';
    case 'rejected':
      return 'rejected';
    default:
      return 'unknown';
  }
}

export function canAcceptWork(status: string): boolean {
  return verificationStateFor(status) === 'verified';
}
