import { z } from 'zod';

import { spaceIdSchema } from '../primitives/ids.js';

export const approveSpaceSchema = z.object({
  spaceId: spaceIdSchema,
  notes: z.string().max(500).optional(),
});

export type ApproveSpace = z.infer<typeof approveSpaceSchema>;
