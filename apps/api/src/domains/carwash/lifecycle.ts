import type { CarwashJobEvent, CarwashJobStatus } from '@parkease/contracts/enums';
import { nextCarwashStatus } from '@parkease/contracts/washer';

import { IllegalCarwashTransitionError } from './errors.js';

/**
 * The API's half of the state machine.
 *
 * The transition table itself lives in `@parkease/contracts/washer`, because
 * the worker moves jobs too and a second copy is a second place for it to
 * drift. What is local here is only how a violation *surfaces*: a 409 with a
 * stable code, which is a Nest concern and has no business inside a package the
 * mobile app imports.
 *
 * No status string is assigned anywhere in this domain except through this
 * function — the same discipline as `domains/booking/lifecycle.ts` and
 * `domains/valet/lifecycle.ts`.
 */
export function assertTransition(from: CarwashJobStatus, event: CarwashJobEvent): CarwashJobStatus {
  const to = nextCarwashStatus(from, event);
  if (to === null) throw new IllegalCarwashTransitionError(from, event);
  return to;
}

/**
 * Which events the machine will accept from here.
 *
 * The job view carries this so the partner app renders one button rather than
 * reimplementing the table and drifting from it. Derived, never listed.
 */
export function availableEvents(from: CarwashJobStatus): CarwashJobEvent[] {
  return CARWASH_EVENTS.filter((event) => nextCarwashStatus(from, event) !== null);
}

const CARWASH_EVENTS: readonly CarwashJobEvent[] = [
  'offer',
  'accept',
  'en_route',
  'start_washing',
  'complete',
  'cancel',
];

export {
  isTerminalCarwashStatus,
  LIVE_CARWASH_STATUSES,
  nextCarwashStatus,
  parseCarwashJobStatus,
} from '@parkease/contracts/washer';
