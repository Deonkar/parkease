import { z } from 'zod';

import { roleSchema } from '../enums/role.js';

export const switchActiveRoleSchema = z.object({
  role: roleSchema,
});

export type SwitchActiveRole = z.infer<typeof switchActiveRoleSchema>;
