import type { CarwashJobEvent } from '@parkease/contracts/enums';

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
