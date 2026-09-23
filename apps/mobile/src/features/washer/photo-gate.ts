import type { CarwashJobEvent, CarwashJobStatus } from '@parkease/contracts/enums';
import { PHOTO_SLOT_OPEN_STATUSES } from '@parkease/contracts/washer';

/**
 * Which single button this job shows, derived from what the SERVER says it
 * will accept.
 *
 * `washJobViewSchema.availableEvents` comes from the transition table
 * (`washer/lifecycle.ts`), so the app never keeps a second copy of the state
 * machine that can drift from the first. This module owns the copy on the
 * button and the photo each event is gated on — nothing else.
 *
 * Pure and free of `react-native`, so the node test environment can reach it.
 */

export type PhotoSlot = 'before' | 'after';

export interface PrimaryAction {
  readonly event: CarwashJobEvent;
  readonly label: string;
  /** The photo that must be attached before this event may be sent (§13.8). */
  readonly requiresSlot: PhotoSlot | null;
}

/**
 * Lifecycle order. Iterating this rather than `availableEvents` is what makes
 * the result deterministic: if the server ever offers two, every device picks
 * the same one, and it is the earlier one.
 */
const DRIVEN_BY_THIS_SCREEN = ['en_route', 'start_washing', 'complete'] as const;

const ACTIONS: Record<(typeof DRIVEN_BY_THIS_SCREEN)[number], Omit<PrimaryAction, 'event'>> = {
  en_route: { label: 'On My Way', requiresSlot: null },
  start_washing: { label: 'Start Washing', requiresSlot: 'before' },
  complete: { label: 'Mark Complete', requiresSlot: 'after' },
};

export function primaryActionFor(availableEvents: readonly string[]): PrimaryAction | null {
  for (const event of DRIVEN_BY_THIS_SCREEN) {
    if (availableEvents.includes(event)) return { event, ...ACTIONS[event] };
  }
  // Terminal, or an event this screen does not drive (`cancel` is the
  // driver's, `offer` is dispatch's). No button beats a wrong button.
  return null;
}

/**
 * Whether the server will take a photo for this slot right now (T7-S1).
 *
 * Read from the same contracts table the API's attach guard reads, so a
 * capture or Retake button can never promise a write the server refuses.
 */
export function canWriteSlot(slot: PhotoSlot, status: CarwashJobStatus): boolean {
  return PHOTO_SLOT_OPEN_STATUSES[slot].includes(status);
}

export type EvidenceSlotState = 'empty' | 'uploading' | 'failed' | 'attached';

/**
 * One slot of the evidence pair, as the partner should read it.
 *
 * `serverAttached` is the gate's truth — the job view's photo id, never local
 * hook state (T7-T1). The local half only describes a capture that is still in
 * flight or has failed, which is why it wins while it exists: a retake being
 * uploaded over an attached photo is, for now, an upload.
 *
 * Except once the slot has CLOSED on an attached photo: a failed retake can
 * never land there any more, so a stale local failure gives way to the photo
 * the server holds rather than showing a Retry the server will refuse.
 */
export function slotStateFor(
  serverAttached: boolean,
  local: { readonly uploading: boolean; readonly error: string | null },
  slot: { readonly writable: boolean },
): EvidenceSlotState {
  if (serverAttached && !slot.writable) return 'attached';
  if (local.uploading) return 'uploading';
  if (local.error !== null) return 'failed';
  return serverAttached ? 'attached' : 'empty';
}

const LOCK_REASONS: Readonly<Record<PhotoSlot, string>> = {
  before: 'Take the before photo to unlock',
  after: 'Take the after photo to unlock',
};

/**
 * Why the primary action is locked, in words (R-FE-12) — or `null` when it is
 * not. `attached` is the SERVER view of the pair.
 */
export function lockReasonFor(
  action: PrimaryAction | null,
  attached: { readonly before: boolean; readonly after: boolean },
): string | null {
  if (action === null || action.requiresSlot === null) return null;
  return attached[action.requiresSlot] ? null : LOCK_REASONS[action.requiresSlot];
}
