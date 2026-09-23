/**
 * What a valet's verification state means for them, and when their licence
 * stops letting them work.
 *
 * Pure and free of `react-native`, so the node test environment can reach it —
 * the same reason `location/health.ts` sits outside its component.
 */

import {
  canAcceptWork,
  verificationStateFor,
  type BannerTone,
  type VerificationBanner,
} from '@/features/shared/verification';

export type { BannerTone, VerificationBanner };

/**
 * How far ahead to warn about a licence.
 *
 * The assignment query filters on `licence_expires_at`, so an expired licence
 * removes a valet from every candidate set **silently** — their jobs simply
 * stop. Six weeks is enough notice to renew without it becoming background
 * noise they learn to dismiss.
 */
export const LICENCE_WARNING_DAYS = 45;

const DAY_MS = 86_400_000;

export interface VerificationView {
  /** Whether the app should let this valet accept a job. */
  readonly canAccept: boolean;
  readonly banner: VerificationBanner | null;
}

/**
 * Fails closed on anything unrecognised.
 *
 * The client lock is a courtesy — the server independently rejects an accept
 * with `403 VALET_NOT_VERIFIED`. But if a status is added server-side and this
 * map has not caught up, guessing "probably fine" would put an unapproved
 * person behind someone's steering wheel. Unknown means not permitted.
 */
export function describeVerification(status: string): VerificationView {
  const canAccept = canAcceptWork(status);

  switch (verificationStateFor(status)) {
    case 'verified':
      return { canAccept, banner: null };

    case 'pending':
      return {
        canAccept,
        banner: {
          tone: 'info',
          title: 'Verification in progress',
          body: "We're checking your documents. You'll be able to accept jobs once approved.",
          action: 'View my documents',
        },
      };

    case 'unverified':
      return {
        canAccept,
        banner: {
          tone: 'info',
          title: 'Finish setting up your account',
          body: 'Upload your driving licence and vehicle details to start accepting jobs.',
          action: 'Upload documents',
        },
      };

    case 'rejected':
      return {
        canAccept,
        banner: {
          tone: 'error',
          title: 'Your documents were not approved',
          body: 'Contact support to find out what to change and submit them again.',
          action: 'Contact support',
        },
      };

    default:
      return {
        canAccept,
        banner: {
          tone: 'info',
          title: 'Verification in progress',
          body: "We're checking your account. Contact support if this does not clear.",
          action: 'Contact support',
        },
      };
  }
}

export interface LicenceWarning {
  readonly expired: boolean;
  readonly daysLeft: number;
  readonly message: string;
}

/**
 * The licence notice, or null when there is nothing worth saying.
 *
 * Whole days, floored, and the expiry day itself still counts as valid — a
 * licence that expires today has not expired yet.
 */
export function licenceWarning(expiresAt: string | null, now: number): LicenceWarning | null {
  if (expiresAt === null) return null;

  const expiry = Date.parse(expiresAt);
  // R-VAL-01: this arrives from the API. An unparseable value produces no
  // warning rather than "expires in NaN days".
  if (Number.isNaN(expiry)) return null;

  const daysLeft = Math.floor((expiry - now) / DAY_MS);

  if (daysLeft < 0) {
    return {
      expired: true,
      daysLeft,
      // Never interpolate a negative count into the copy.
      message: 'Your licence has expired. Upload a renewal to start taking jobs again.',
    };
  }

  if (daysLeft > LICENCE_WARNING_DAYS) return null;

  const dayWord = daysLeft === 1 ? 'day' : 'days';
  return {
    expired: false,
    daysLeft,
    message: `Your licence expires in ${String(daysLeft)} ${dayWord}. Upload a renewal to keep taking jobs.`,
  };
}

/** How a document row reads, given the account status and whether one exists. */
export type DocumentState = 'verified' | 'pending' | 'failed' | 'missing';

/**
 * The single owner of "what does this verification status mean for a document".
 *
 * Lives beside `describeVerification` so the profile screen's rows and the
 * offers screen's Accept lock cannot drift apart — the profile screen first
 * carried its own inline `=== 'verified'` check, which is exactly the second
 * copy this prevents.
 */
export function documentStateFor(verificationStatus: string, hasDocument: boolean): DocumentState {
  if (!hasDocument) return 'missing';
  if (canAcceptWork(verificationStatus)) return 'verified';
  return verificationStatus === 'rejected' ? 'failed' : 'pending';
}
