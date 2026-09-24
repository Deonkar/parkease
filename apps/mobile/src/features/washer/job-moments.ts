import type { CarwashJobStatus } from '@parkease/contracts/enums';
import type { WashJobView } from '@parkease/contracts/washer';

import { assertNever } from '@/lib/assert-never';

/**
 * The "It's yours" moment after a won accept (M9). Only on the job the partner
 * has just won (the offers screen passes its id), and only until they set
 * off: once "On my way" is pressed, the step rail carries the story.
 */
export function showsJobWon(
  wonJobId: string | undefined,
  job: Pick<WashJobView, 'id' | 'status'>,
): boolean {
  return wonJobId === job.id && job.status === 'accepted';
}

export type JobEnd = 'completed' | 'cancelled';

/** Which ending a job has, or `null` while it is still running (M9). */
export function jobEndFor(status: CarwashJobStatus): JobEnd | null {
  switch (status) {
    case 'completed':
    case 'cancelled':
      return status;
    case 'requested':
    case 'offered':
    case 'accepted':
    case 'en_route':
    case 'washing':
      return null;
    default:
      return assertNever(status);
  }
}
