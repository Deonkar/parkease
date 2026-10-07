import { pushReceipts, pushTokens } from '@parkease/db/schema';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { JobDeps } from '../../deps.js';
import { logger } from '../../logger.js';

import { expoPush, type PushGateway } from './expo.js';

export const NOTIFICATION_FETCH_RECEIPTS_JOB = 'notification.fetch-receipts';

/** Expo has receipts about 15 minutes after a send, and drops them after 24 hours. */
const READY_AFTER_MINUTES = 15;
const EXPIRES_AFTER_HOURS = 24;
const BATCH = 1000;

/**
 * Reads the receipts of tickets sent at least 15 minutes ago. `DeviceNotRegistered` deactivates
 * the token the ticket was for — correlated by ticket id, not by position, so batch size cannot
 * shift it. A receipt Expo has not produced is left for the next run; one older than Expo keeps
 * them is closed with a warning rather than retried forever.
 */
export async function fetchReceipts(deps: JobDeps, push: PushGateway = expoPush): Promise<void> {
  const pending = await deps.db
    .select({
      ticketId: pushReceipts.ticketId,
      tokenId: pushReceipts.tokenId,
      createdAt: pushReceipts.createdAt,
    })
    .from(pushReceipts)
    .where(
      and(
        isNull(pushReceipts.processedAt),
        lt(pushReceipts.createdAt, sql`now() - make_interval(mins => ${READY_AFTER_MINUTES})`),
      ),
    )
    .limit(BATCH);
  if (pending.length === 0) return;

  const receipts = await push.receipts(pending.map((p) => p.ticketId));
  const expiry = Date.now() - EXPIRES_AFTER_HOURS * 3_600_000;
  const done: string[] = [];

  for (const entry of pending) {
    const receipt = receipts[entry.ticketId];
    if (receipt === undefined) {
      if (entry.createdAt.getTime() >= expiry) continue;
      logger.warn({ ticketId: entry.ticketId }, 'push receipt expired unread');
    } else if (receipt.status === 'error') {
      if (receipt.error === 'DeviceNotRegistered') {
        await deps.db
          .update(pushTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(pushTokens.id, entry.tokenId));
      } else {
        logger.warn(
          {
            ticketId: entry.ticketId,
            tokenId: entry.tokenId,
            error: receipt.error,
            message: receipt.message,
          },
          'push receipt error',
        );
      }
    }
    done.push(entry.ticketId);
  }

  if (done.length > 0) {
    await deps.db
      .update(pushReceipts)
      .set({ processedAt: new Date(), updatedAt: new Date() })
      .where(inArray(pushReceipts.ticketId, done));
  }
}
