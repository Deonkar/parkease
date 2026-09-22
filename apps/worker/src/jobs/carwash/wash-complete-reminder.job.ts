import { outboxMessages, washJobs } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { carwashCompleteReminderPayloadSchema, parseCarwashJobPayload } from './payload.js';

/**
 * One service-duration after the partner accepted, nudge them if the job is
 * still open.
 *
 * Scheduled from the duration on the partner's own menu row, read at accept, so
 * a Quick Wipe is chased after ten minutes and a Full Detailing after an hour.
 * A fixed interval would either pester somebody mid-detail or let a ten-minute
 * wipe sit open all afternoon.
 *
 * This only ever *reminds*. It does not advance the job, and it deliberately
 * cannot: `complete` requires an after photo, and a worker that could move a
 * job past that gate would be a worker that can close a wash nobody did.
 */
export async function washCompleteReminder(deps: JobDeps, raw: unknown): Promise<void> {
  const { jobId } = parseCarwashJobPayload(carwashCompleteReminderPayloadSchema, raw);

  const [job] = await deps.db.select().from(washJobs).where(eq(washJobs.id, jobId));

  /**
   * Idempotent by guard, because pg-boss delivery is at-least-once
   * (R-ASYNC-03). Every early return here is a normal outcome rather than an
   * error — and a redelivery after the partner finished must not send a second
   * "are you done?" to somebody who already is.
   */
  if (job === undefined) {
    logger.warn({ jobId }, 'carwash complete-reminder: job no longer exists');
    return;
  }

  if (job.status !== 'washing') {
    logger.info(
      { jobId, status: job.status },
      'carwash complete-reminder: not washing, nothing to nudge',
    );
    return;
  }

  if (job.washerUserId === null) {
    // `wash_jobs_assignee_presence_check` makes this unreachable for a job in
    // `washing`. Loud rather than silent, because the alternative reading is
    // that the constraint was bypassed (R-FAIL-01).
    throw new Error(`Car wash job ${job.id} is washing with no partner assigned`);
  }

  await deps.db.insert(outboxMessages).values({
    type: 'notification.dispatch',
    payload: {
      userId: job.washerUserId,
      template: 'washer.complete_reminder',
      data: { jobId: job.id, serviceName: job.serviceName },
    },
  });

  logger.info({ jobId: job.id }, 'carwash complete-reminder: nudged the partner');
}
