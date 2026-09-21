import type { ValetJobEvent, ValetJobStatus } from '@parkease/contracts/enums';
import { nextValetStatus } from '@parkease/contracts/valet';

import { IllegalValetTransitionError } from './errors.js';

/**
 * The API's half of the state machine.
 *
 * The transition table itself lives in `@parkease/contracts/valet`, because the
 * worker moves jobs too and a second copy is a second place for it to drift.
 * What is local here is only how a violation *surfaces*: a 409 with a stable
 * code, which is a Nest concern and has no business inside a package the mobile
 * app imports.
 *
 * No status string is assigned anywhere in this domain except through this
 * function — the same discipline as `domains/booking/lifecycle.ts`.
 */
export function assertTransition(from: ValetJobStatus, event: ValetJobEvent): ValetJobStatus {
  const to = nextValetStatus(from, event);
  if (to === null) throw new IllegalValetTransitionError(from, event);
  return to;
}

export {
  isTerminalValetStatus,
  nextValetStatus,
  TRACKED_VALET_STATUSES,
  valetHoldsVehicle,
} from '@parkease/contracts/valet';
