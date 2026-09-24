import type { VerificationStatus } from '@parkease/contracts/enums';

import {
  canAcceptWork,
  verificationStateFor,
  type VerificationBanner,
} from '@/features/shared/verification';
import { assertNever } from '@/lib/assert-never';

export interface WasherVerificationView {
  readonly canAccept: boolean;
  readonly banner: VerificationBanner | null;
}

/**
 * §14.7. A washer awaiting verification browses offers and cannot accept them.
 *
 * The banner sits on the OFFERS screen, not only on the profile: a partner who
 * can see three jobs and the money within reach has a reason to finish their
 * document upload. An empty locked screen gives them nothing to come back for.
 */
export function describeWasherVerification(status: VerificationStatus): WasherVerificationView {
  // Parsed again rather than trusted: a server ahead of this build can still
  // send a status the contract here does not list, and that must fail closed.
  const state = verificationStateFor(status);
  const canAccept = canAcceptWork(state);

  switch (state) {
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
          // Only a gig partner can be `unverified` — a business lands
          // `pending` with its photos — so this asks for the ID photo alone (J2).
          body: 'Add a photo of your ID proof so we can verify you and send you jobs.',
          action: 'Add ID photo',
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

    case 'unknown':
      return {
        canAccept,
        banner: {
          tone: 'info',
          title: 'Verification in progress',
          body: "We're checking your account. Contact support if this does not clear.",
          action: 'Contact support',
        },
      };

    default:
      return assertNever(state);
  }
}
