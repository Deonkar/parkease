import type { VerificationStatus } from '@parkease/contracts/enums';

import {
  canAcceptWork,
  verificationStateFor,
  type VerificationBanner,
} from '@/features/shared/verification';
import { assertNever } from '@/lib/assert-never';

/** The actions this copy offers, each with somewhere to go (M10). */
const VIEW_DOCUMENTS = 'View my documents';
const ADD_ID_PHOTO = 'Add ID photo';

/** Where a banner action leads. The documents both actions name are on the profile. */
export type WasherBannerRoute = '/(washer)/profile';

/**
 * Routes a banner action by what it says (M10, impeccable P4). An action with
 * nowhere to go returns `null`, and the banner then draws no button: before,
 * every action (including "Contact support") opened the profile, which has no
 * support row, so the button promised something the screen did not have.
 */
export function bannerActionRoute(action: string | null): WasherBannerRoute | null {
  return action === null ? null : (BANNER_ROUTES.get(action) ?? null);
}

const BANNER_ROUTES: ReadonlyMap<string, WasherBannerRoute> = new Map([
  [VIEW_DOCUMENTS, '/(washer)/profile'],
  [ADD_ID_PHOTO, '/(washer)/profile'],
]);

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
          action: VIEW_DOCUMENTS,
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
          action: ADD_ID_PHOTO,
        },
      };

    case 'rejected':
      return {
        canAccept,
        banner: {
          tone: 'error',
          title: 'Your documents were not approved',
          body: 'Your documents were not approved. Please review and resubmit them.',
          // No button (M10): the app has no support surface yet, and one that
          // opened the profile would lead nowhere. A suggestedtask row adds it.
          action: null,
        },
      };

    case 'unknown':
      return {
        canAccept,
        banner: {
          tone: 'info',
          title: 'Verification in progress',
          body: "We're checking your account. You'll be told what to do next.",
          action: null,
        },
      };

    default:
      return assertNever(state);
  }
}
