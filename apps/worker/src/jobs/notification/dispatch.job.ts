import {
  DEFAULT_PUSH_ENABLED,
  isNotificationTemplate,
  renderNotification,
} from '@parkease/contracts/shared';
import {
  notificationPreferences,
  notifications,
  pushReceipts,
  pushTokens,
  users,
} from '@parkease/db/schema';
import { and, eq } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import { z } from 'zod';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { expoPush, type PushGateway } from './expo.js';

const payloadSchema = z.object({
  userId: z.string().uuid(),
  template: z.string(),
  data: z.record(z.unknown()).default({}),
});

export type NotificationPayload = z.input<typeof payloadSchema>;

/**
 * Delivers one `notification.dispatch` job: the in-app row first, then the push.
 *
 * Idempotent on the pg-boss job id (R-ASYNC-03). The in-app row carries it as `dedupe_key`; a
 * redelivery conflicts, finds the work done, and sends nothing. The one gap: a user with the
 * in-app channel off has no row to conflict on, so a crash between the push and its receipt row can
 * send that push twice. ponytail: a push-only dedupe table if that ever shows up in the logs.
 *
 * The preference gate is per channel: push off still writes the in-app row; in-app off still pushes.
 */
async function dispatchOne(
  deps: JobDeps,
  jobId: string,
  raw: unknown,
  push: PushGateway,
): Promise<void> {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success || !isNotificationTemplate(parsed.data.template)) {
    // A retry cannot fix a payload that is wrong; failing the job would only repeat it five times.
    logger.error(
      { jobId, issues: parsed.success ? 'unknown template' : parsed.error.issues },
      'notification dispatch: bad payload dropped',
    );
    return;
  }
  const { userId, template, data } = parsed.data;

  const [user] = await deps.db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.status !== 'active') return;

  const rendered = renderNotification(template, data);
  const [prefRow] = await deps.db
    .select({ preferences: notificationPreferences.preferences })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const pref = prefRow?.preferences[rendered.category];
  const inApp = pref?.inApp ?? true;
  const wantsPush = pref?.push ?? DEFAULT_PUSH_ENABLED[rendered.category];

  let rowId: string | undefined;
  if (inApp) {
    const [row] = await deps.db
      .insert(notifications)
      .values({
        userId,
        type: template,
        category: rendered.category,
        actionable: rendered.actionable,
        title: rendered.title,
        body: rendered.body,
        data,
        deepLink: rendered.deepLink,
        dedupeKey: jobId,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (row === undefined) return;
    rowId = row.id;
  }
  if (!wantsPush) return;

  const tokens = await deps.db
    .select({ id: pushTokens.id, token: pushTokens.token })
    .from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.isActive, true)));
  if (tokens.length === 0) return;

  // Outside any transaction (rule 4).
  let tickets;
  try {
    tickets = await push.send(
      tokens.map((t) => ({
        to: t.token,
        title: rendered.title,
        body: rendered.body,
        data: { ...data, template, deepLink: rendered.deepLink },
        channelId: rendered.category,
      })),
    );
  } catch (error) {
    // Un-write the row so the retry is not mistaken for a finished delivery and the push lost.
    if (rowId !== undefined) {
      await deps.db.delete(notifications).where(eq(notifications.id, rowId));
    }
    throw error;
  }

  // tickets[i] answers tokens[i]; the gateway keeps that order across chunks.
  for (const [i, ticket] of tickets.entries()) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (ticket.status === 'ok') {
      await deps.db
        .insert(pushReceipts)
        .values({ ticketId: ticket.id, tokenId: token.id })
        .onConflictDoNothing();
    } else if (ticket.error === 'DeviceNotRegistered') {
      await deps.db
        .update(pushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pushTokens.id, token.id));
    } else {
      logger.warn(
        { jobId, userId, tokenId: token.id, error: ticket.error, message: ticket.message },
        'push ticket error',
      );
    }
  }
}

export async function dispatchNotifications(
  deps: JobDeps,
  jobs: PgBoss.Job<unknown>[],
  push: PushGateway = expoPush,
): Promise<void> {
  const failures: unknown[] = [];
  for (const job of jobs) {
    try {
      await dispatchOne(deps, job.id, job.data, push);
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, 'notification dispatch failed; will retry');
      failures.push(error);
    }
  }
  // Retrying the batch is safe: jobs that finished conflict on their dedupe key and send nothing.
  if (failures.length > 0) throw new AggregateError(failures, 'notification dispatch failed');
}
