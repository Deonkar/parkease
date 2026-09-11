import { z } from 'zod';

import { userIdSchema } from '../primitives/ids.js';

export const blockUserSchema = z.object({
  userId: userIdSchema,
  reason: z.string().min(1).max(500),
});

export type BlockUser = z.infer<typeof blockUserSchema>;
