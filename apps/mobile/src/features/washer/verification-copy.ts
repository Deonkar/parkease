import {
  canAcceptWork,
  verificationStateFor,
  type VerificationBanner,
} from '@/features/shared/verification';

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
export function describeWasherVerification(status: string): WasherVerificationView {
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
          body: 'Add your ID proof and photos so we can verify you and send you jobs.',
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
