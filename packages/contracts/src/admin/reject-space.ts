import { z } from 'zod';

import { spaceIdSchema } from '../primitives/ids.js';

export const rejectSpaceSchema = z.object({
  spaceId: spaceIdSchema,
  reason: z.string().min(1).max(500),
});

export type RejectSpace = z.infer<typeof rejectSpaceSchema>;
