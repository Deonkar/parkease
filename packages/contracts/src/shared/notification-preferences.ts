import { z } from 'zod';

import { NOTIFICATION_CATEGORIES } from './notification-catalog.js';

export const notificationPreferenceSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  pushEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesSchema = z.array(notificationPreferenceSchema);

/** A partial update: only the categories sent change. */
export const updateNotificationPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        pushEnabled: z.boolean().optional(),
        inAppEnabled: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
