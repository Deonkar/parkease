import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { notificationIdSchema } from '@parkease/contracts/primitives';
import {
  deactivatePushTokenSchema,
  notificationFeedQuerySchema,
  notificationFeedSchema,
  notificationPreferencesSchema,
  type NotificationFeed,
  type NotificationPreference,
  registerPushTokenSchema,
  type UnreadCount,
  unreadCountSchema,
  updateNotificationPreferencesSchema,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { NotificationService } from '../../domains/notification/notification.service.js';
import { type AuthUser, CurrentUser } from '../../platform/auth/current-user.decorator.js';
import { parseOutgoing } from '../../platform/http/outgoing-contract.js';

import { toNotificationView } from './views/notification.view.js';

const idParamsSchema = z.object({ id: notificationIdSchema });

/**
 * The notification feed, its preferences and the device's push token. Under `/me` and open to every
 * role: any signed-in person has a feed. Everything is scoped to the caller; a mutation reaches
 * only rows the caller owns.
 */
@Controller('me')
export class MeNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('notifications')
  async feed(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<NotificationFeed> {
    const q = notificationFeedQuerySchema.parse(query ?? {});
    const page = await this.notifications.feed(user.id, {
      limit: q.limit,
      ...(q.cursor === undefined ? {} : { cursor: q.cursor }),
    });
    return parseOutgoing(
      notificationFeedSchema,
      {
        items: page.items.map(toNotificationView),
        meta: { limit: q.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
      },
      'notification feed page',
    );
  }

  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCount> {
    return parseOutgoing(
      unreadCountSchema,
      { count: await this.notifications.unreadCount(user.id) },
      'unread count',
    );
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.notifications.readAll(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@CurrentUser() user: AuthUser, @Param() params: unknown): Promise<void> {
    const { id } = idParamsSchema.parse(params);
    await this.notifications.markRead(user.id, id);
  }

  @Get('notifications/preferences')
  async preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreference[]> {
    return parseOutgoing(
      notificationPreferencesSchema,
      await this.notifications.preferences(user.id),
      'notification preferences',
    );
  }

  @Put('notifications/preferences')
  async updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<NotificationPreference[]> {
    const update = updateNotificationPreferencesSchema.parse(body);
    return parseOutgoing(
      notificationPreferencesSchema,
      await this.notifications.updatePreferences(user.id, update),
      'notification preferences',
    );
  }

  @Post('push-tokens')
  @HttpCode(204)
  async registerToken(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const { token, platform } = registerPushTokenSchema.parse(body);
    await this.notifications.registerPushToken(user.id, token, platform);
  }

  @Delete('push-tokens')
  @HttpCode(204)
  async deactivateToken(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<void> {
    const { token } = deactivatePushTokenSchema.parse(body);
    await this.notifications.deactivatePushToken(user.id, token);
  }
}
