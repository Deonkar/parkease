import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import {
  type NotificationPreference,
  notificationPreferencesSchema,
  notificationViewSchema,
  unreadCountSchema,
  type UpdateNotificationPreferences,
} from '@parkease/contracts/shared';
import { z } from 'zod';

import { api, newIntent } from '@/lib/api';

import { isSharedDevMock } from '../dev-mock';

import { devNotifications } from './dev-fixtures';

/**
 * The notification endpoints (task 19a). Every response is parsed, never asserted (R-VAL-01).
 * Each mutation mints its own key per call: one press is one intent, and nothing here retries
 * behind the user's back.
 */
const feedPageSchema = z.object({
  data: z.array(notificationViewSchema),
  meta: cursorPageMetaSchema,
});
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data });

const isDevMock = (): Promise<boolean> => isSharedDevMock('notifications.isDevMock');
const withKey = () => ({ headers: { 'Idempotency-Key': newIntent().idempotencyKey } });

export async function fetchFeed(cursor: string | undefined, signal?: AbortSignal) {
  if (await isDevMock()) return devNotifications.feed(cursor);
  const response = await api.get<unknown>('/me/notifications', {
    params: { limit: 20, ...(cursor === undefined ? {} : { cursor }) },
    signal,
  });
  return feedPageSchema.parse(response.data);
}

export async function fetchUnreadCount(signal?: AbortSignal): Promise<number> {
  if (await isDevMock()) return devNotifications.unread();
  const response = await api.get<unknown>('/me/notifications/unread-count', { signal });
  return envelope(unreadCountSchema).parse(response.data).data.count;
}

export async function markRead(id: string): Promise<void> {
  if (await isDevMock()) return devNotifications.markRead(id);
  await api.post(`/me/notifications/${id}/read`, {}, withKey());
}

export async function markAllRead(): Promise<void> {
  if (await isDevMock()) return devNotifications.markAllRead();
  await api.post('/me/notifications/read-all', {}, withKey());
}

export async function fetchPreferences(signal?: AbortSignal): Promise<NotificationPreference[]> {
  if (await isDevMock()) return devNotifications.preferences();
  const response = await api.get<unknown>('/me/notifications/preferences', { signal });
  return envelope(notificationPreferencesSchema).parse(response.data).data;
}

export async function savePreferences(
  update: UpdateNotificationPreferences,
): Promise<NotificationPreference[]> {
  if (await isDevMock()) return devNotifications.save(update);
  const response = await api.put<unknown>('/me/notifications/preferences', update, withKey());
  return envelope(notificationPreferencesSchema).parse(response.data).data;
}

export async function registerPushToken(token: string, platform: 'android' | 'ios'): Promise<void> {
  await api.post('/me/push-tokens', { token, platform }, withKey());
}

export async function deactivatePushToken(token: string): Promise<void> {
  await api.delete('/me/push-tokens', { data: { token }, ...withKey() });
}
