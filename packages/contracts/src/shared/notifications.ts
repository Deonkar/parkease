import { z } from 'zod';

import { notificationTypeSchema } from '../enums/notification-type.js';
import { notificationIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';

export const notificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const notificationSchema = z.object({
  id: notificationIdSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  data: z.record(z.unknown()).nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Notification = z.infer<typeof notificationSchema>;

export const markReadSchema = z.object({
  notificationIds: z.array(notificationIdSchema).min(1).max(100),
});

export type MarkRead = z.infer<typeof markReadSchema>;
