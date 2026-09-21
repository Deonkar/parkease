import {
  computeValetLegFee,
  computeValetNoShowFee,
  valetChargeAdjustmentEntries,
} from '@parkease/contracts/money';
import { toRate } from '@parkease/contracts/primitives';
import { NO_SHOW_GRACE_MS, nextValetStatus, parseValetJobStatus } from '@parkease/contracts/valet';
import { uuidv7 } from '@parkease/db/id';
import { outboxMessages, valetJobs } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';
import { postLedger } from '../booking/ledger.js';

import { noShowPayloadSchema, parseValetJobPayload } from './payload.js';

/**
 * Ten minutes after the valet arrived with no driver, the call-out is owed.
 *
 * The driver is charged the **base component only** — the distance component is
 * waived, because the distance was travelled for a job that did not happen and
 * billing per-kilometre for a wasted trip reads as a penalty rather than as the
 * call-out fee it is. The valet is paid, because they did the work they were
 * asked to do (§11.8).
 *
 * The outbound leg was already charged at accept, so this reverses the
 * *difference* rather than charging again: the driver ends up owing the call-out,
 * not the call-out on top of a full leg.
 */
export async function noShow(deps: JobDeps, raw: unknown): Promise<void> {
  const { jobId } = parseValetJobPayload(noShowPayloadSchema, raw);

  await deps.db.transaction(async (tx) => {
    // FOR UPDATE, so two concurrent deliveries cannot both read `arrived` and
    // both post an adjustment.
    const [job] = await tx.select().from(valetJobs).where(eq(valetJobs.id, jobId)).for('update');

    if (job === undefined) {
      logger.warn({ jobId }, 'valet no-show: job no longer exists');
      return;
    }

    /**
     * Idempotent by guard (R-ASYNC-03). A redelivery, a driver who turned up and
     * had their car parked, or a job cancelled in the meantime are all no-ops
     * rather than errors — every one of them is a normal outcome.
     */
    if (job.status !== 'arrived') {
      logger.info({ jobId, status: job.status }, 'valet no-show: already resolved');
      return;
    }

    /**
     * The grace period re-checked against the clock, not assumed from the
     * schedule. pg-boss can deliver early after a restart, and a job delivered
     * at 9m59s must not bill a driver who is thirty seconds from arriving.
     */
    if (job.arrivedAt === null || Date.now() - job.arrivedAt.getTime() < NO_SHOW_GRACE_MS) {
      logger.info({ jobId }, 'valet no-show: grace period has not lapsed');
      return;
    }

    const to = nextValetStatus(parseValetJobStatus(job.status), 'no_show');
    if (to === null) {
      throw new Error(`Valet job ${job.id} cannot be marked no_show from '${job.status}'`);
    }

    await tx
      .update(valetJobs)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(valetJobs.id, job.id));

    /**
     * A job can only reach `arrived` with an assignee and a priced leg — the
     * assignee-presence CHECK and the accept command together guarantee it — so
     * a null here is a broken invariant, not a case to handle quietly.
     */
    if (job.assignedUserId === null || job.txnId === null) {
      throw new Error(`Valet job ${job.id} is arrived with no assignee or no txn id`);
    }

    const rate = toRate(Number(job.commissionRate));
    const charged = computeValetLegFee(job.distanceM ?? 0, rate);
    const retained = computeValetNoShowFee(rate);

    const entries = valetChargeAdjustmentEntries(
      charged,
      retained,
      job.assignedUserId,
      'valet no-show call-out adjustment',
    );

    // Empty when the leg was priced at exactly the call-out fee, at zero
    // distance. Nothing to give back, so nothing is posted — an empty posting
    // would abort the transaction.
    if (entries.length > 0) {
      const txnId = uuidv7();
      await postLedger(tx, { txnId, bookingId: job.bookingId, entries });

      await tx.insert(outboxMessages).values({
        type: 'payment.issue-refund',
        payload: {
          txnId: job.txnId,
          amountPaise: charged.driverTotalPaise - retained.driverTotalPaise,
        },
      });
    }

    await tx.insert(outboxMessages).values({
      type: 'notification.dispatch',
      payload: {
        userId: job.driverUserId,
        template: 'valet.no_show',
        data: { jobId: job.id },
      },
    });

    logger.info(
      { jobId: job.id, retainedPaise: retained.driverTotalPaise },
      'valet no-show: call-out charged',
    );
  });
}
