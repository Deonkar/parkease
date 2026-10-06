import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { userIdSchema } from '../primitives/ids.js';

export const adminSessionSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  user: z.object({
    id: userIdSchema,
    roles: z.array(roleSchema),
  }),
});

export type AdminSession = z.infer<typeof adminSessionSchema>;
