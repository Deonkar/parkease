import { Inject, Injectable } from '@nestjs/common';
import { notifications, notificationPreferences } from '@parkease/db/schema';
import { eq } from 'drizzle-orm';

import { DB, type Database } from '../../platform/db/db.module.js';
import type { TxHandle } from '../../platform/db/transaction.js';
import { logger } from '../../platform/observability/logger.js';

export interface SendNotificationInput {
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async send(input: SendNotificationInput): Promise<void> {
    const prefRows = await this.db
      .select({ preferences: notificationPreferences.preferences })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, input.userId));

    const prefs = prefRows[0]?.preferences;
    if (prefs) {
      const typeKey = input.type as keyof typeof prefs;
      if (prefs[typeKey] === false) {
        logger.debug(
          { userId: input.userId, type: input.type },
          'notification suppressed by preference',
        );
        return;
      }
    }

    await this.db.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
    });
  }

  async persistFromJob(tx: TxHandle, input: SendNotificationInput): Promise<void> {
    await tx.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
    });
  }
}
