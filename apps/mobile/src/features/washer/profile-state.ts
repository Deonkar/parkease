import type { WasherPartnerType } from '@parkease/contracts/washer';

import {
  resolveScreenState,
  type QueryShape,
  type ScreenState,
} from '@/features/shared/screen-state';
import { verificationStateFor } from '@/features/shared/verification';

import { isUnregisteredWasher } from './api/errors';

export type ProfileScreenState = ScreenState | 'unregistered';

export interface ProfileQueryShape<T> extends QueryShape<T> {
  readonly error: unknown;
}

/**
 * Which state the profile screen is in.
 *
 * The profile is the default entry for a washer who has not registered, so
 * `404 WASHER_PROFILE_NOT_FOUND` is its first-run state with a next step, never
 * an error. Everything else is the shared decision (R-FE-08): a cached profile
 * stays on screen when a refetch fails (ruling T7-I2), so "not registered" is
 * only believed when there is no profile to show.
 */
export function profileScreenState<T>(query: ProfileQueryShape<T>): ProfileScreenState {
  const state = resolveScreenState(query);
  if (state === 'error' && isUnregisteredWasher(query.error)) return 'unregistered';
  return state;
}

/** The reasons registration hands the profile screen, as a route param. */
export type RegistrationNoticeKind = 'registered' | 'document-not-sent' | 'already-registered';

/**
 * The one line the profile says after registration, true to the server.
 *
 * "Submitted for review" only once the server says `pending`: a business lands
 * there on registering (ruling T10-C1), a gig partner once their ID image has
 * arrived. A business is reviewed on its photos, so it is never asked for an ID.
 */
export function registrationNotice(
  kind: string | undefined,
  status: string,
  partnerType: WasherPartnerType,
): string | null {
  if (kind !== 'registered' && kind !== 'document-not-sent' && kind !== 'already-registered') {
    return null;
  }
  // An earlier attempt registered this partner with other details (G6): what
  // is below is what the server kept, which may not be what they just typed.
  if (kind === 'already-registered') {
    return 'You were already registered. Check your details below: they are from your first attempt.';
  }
  // Also true once an ID sent from this screen later puts the profile in review.
  if (verificationStateFor(status) === 'pending') {
    return "Submitted for review. We'll let you know once your documents are checked.";
  }
  if (partnerType === 'business') return 'Profile saved.';
  return kind === 'registered'
    ? 'Profile saved. Add a photo of your ID below to send it for review.'
    : "Your profile is saved, but your ID photo didn't send. Add it again below.";
}
