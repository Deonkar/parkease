import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { userIdSchema } from '../primitives/ids.js';

export const grantRoleSchema = z.object({
  userId: userIdSchema,
  role: roleSchema,
});

export type GrantRole = z.infer<typeof grantRoleSchema>;
