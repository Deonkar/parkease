import { z } from 'zod';

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshSession = z.infer<typeof refreshSessionSchema>;
