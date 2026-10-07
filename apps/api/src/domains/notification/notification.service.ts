import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_PUSH_ENABLED,
  NOTIFICATION_CATEGORIES,
  type NotificationPreference,
  type UpdateNotificationPreferences,
} from '@parkease/contracts/shared';
import {
  notificationPreferences,
  type NotificationPreferencesMap,
  notifications,
  pushTokens,
} from '@parkease/db/schema';
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';

import { NotificationNotFoundError } from './errors.js';

export type NotificationRow = typeof notifications.$inferSelect;

/**
 * The recipient's feed, preferences and push tokens. Every query is scoped by `user_id` (R-SEC-04):
 * another user's notification is a 404, never a 403, so its existence is not confirmed.
 *
 * Delivery is the worker's (`jobs/notification/`); this is only the read side and the token
 * registry the worker reads.
 */
@Injectable()
export class NotificationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Keyset on the UUIDv7 id, newest first. */
  async feed(userId: string, opts: { limit: number; cursor?: string }) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          opts.cursor === undefined ? undefined : lt(notifications.id, opts.cursor),
        ),
      )
      .orderBy(desc(notifications.id))
      .limit(opts.limit + 1);

    const items = rows.slice(0, opts.limit);
    const hasMore = rows.length > opts.limit;
    return { items, hasMore, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return row?.n ?? 0;
  }

  /** Idempotent: reading a read notification changes nothing, so `read_at` keeps its first value. */
  async markRead(userId: string, id: string): Promise<void> {
    const [owned] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (owned === undefined) throw new NotificationNotFoundError();

    await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        ),
      );
  }

  async readAll(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  /** A missing row, or a missing category in it, is the default — never "everything on". */
  async preferences(userId: string): Promise<NotificationPreference[]> {
    const stored = await this.storedPreferences(userId);
    return NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      pushEnabled: stored[category]?.push ?? DEFAULT_PUSH_ENABLED[category],
      inAppEnabled: stored[category]?.inApp ?? true,
    }));
  }

  async updatePreferences(
    userId: string,
    update: UpdateNotificationPreferences,
  ): Promise<NotificationPreference[]> {
    const next: NotificationPreferencesMap = { ...(await this.storedPreferences(userId)) };
    for (const { category, pushEnabled, inAppEnabled } of update.preferences) {
      next[category] = {
        ...next[category],
        ...(pushEnabled === undefined ? {} : { push: pushEnabled }),
        ...(inAppEnabled === undefined ? {} : { inApp: inAppEnabled }),
      };
    }
    await this.db
      .insert(notificationPreferences)
      .values({ userId, preferences: next })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { preferences: next, updatedAt: new Date() },
      });
    return this.preferences(userId);
  }

  /**
   * Upsert on the token: the same token for the same user is a no-op, and for a different user it
   * moves (a reinstall, or a phone handed on). A token Expo once called dead is revived — the
   * device just registered it again, which is the proof that it is alive.
   */
  async registerPushToken(userId: string, token: string, platform: string): Promise<void> {
    await this.db
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, platform, isActive: true, updatedAt: sql`now()` },
      });
  }

  /** The row stays, for audit and for reactivation. Someone else's token is not theirs to retire. */
  async deactivatePushToken(userId: string, token: string): Promise<void> {
    await this.db
      .update(pushTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
  }

  private async storedPreferences(userId: string): Promise<NotificationPreferencesMap> {
    const [row] = await this.db
      .select({ preferences: notificationPreferences.preferences })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    return row?.preferences ?? {};
  }
}
