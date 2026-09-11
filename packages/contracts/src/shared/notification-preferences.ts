import { z } from 'zod';

import { notificationTypeSchema } from '../enums/notification-type.js';

export const notificationPreferenceSchema = z.object({
  type: notificationTypeSchema,
  push: z.boolean(),
  email: z.boolean(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).min(1),
});

export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
