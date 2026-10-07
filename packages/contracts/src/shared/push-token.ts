import { z } from 'zod';

/** Expo push tokens look like `ExponentPushToken[...]`; the API checks shape, Expo checks life. */
const expoPushToken = z.string().regex(/^(Exponent|Expo)PushToken\[[^\]]+\]$/);

export const registerPushTokenSchema = z.object({
  token: expoPushToken,
  platform: z.enum(['ios', 'android']),
});
export type RegisterPushToken = z.infer<typeof registerPushTokenSchema>;

export const deactivatePushTokenSchema = z.object({ token: expoPushToken });
export type DeactivatePushToken = z.infer<typeof deactivatePushTokenSchema>;
