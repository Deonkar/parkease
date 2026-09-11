import { z } from 'zod';

export const registerPushTokenSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(['ios', 'android']),
});

export type RegisterPushToken = z.infer<typeof registerPushTokenSchema>;
