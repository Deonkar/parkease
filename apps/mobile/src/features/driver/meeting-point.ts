import type { MeetingPoint } from './api/addons';

/** The contract's own bound on an address (`requestValetSchema`). */
export const MAX_ADDRESS_LENGTH = 255;

export interface MeetingPointDraft {
  readonly point: { readonly lat: number; readonly lng: number } | null;
  readonly address: string;
}

export type MeetingPointCheck =
  | { readonly ok: true; readonly value: MeetingPoint }
  | { readonly ok: false; readonly error: string };

/**
 * What the form can send, or why it cannot yet. Separate from the component so
 * the two refusals — no location, no words for it — are tested on their own.
 *
 * Both are needed: the point is where the valet navigates to, and the words are
 * what they look for when they get there ("Gate 2, by the pharmacy"). A GPS fix
 * alone is a dot on a map in a crowded street.
 */
export function checkMeetingPoint(draft: MeetingPointDraft): MeetingPointCheck {
  if (draft.point === null) {
    return { ok: false, error: 'Use your current location or search for a place.' };
  }
  const address = draft.address.trim();
  if (address.length === 0) {
    return { ok: false, error: 'Tell the valet where exactly to find you.' };
  }
  return {
    ok: true,
    value: { ...draft.point, address: address.slice(0, MAX_ADDRESS_LENGTH) },
  };
}
