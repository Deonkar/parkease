import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { userStatusSchema } from '../enums/user-status.js';
import { userIdSchema } from '../primitives/ids.js';
import { paginationQuerySchema } from '../primitives/pagination.js';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  search: z.string().max(200).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const adminUserSchema = z.object({
  id: userIdSchema,
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  status: userStatusSchema,
  roles: z.array(roleSchema),
  createdAt: z.string().datetime(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;
