import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { userStatusSchema } from '../enums/user-status.js';
import { userIdSchema } from '../primitives/ids.js';

export const meResponseSchema = z.object({
  id: userIdSchema,
  phone: z.string(),
  name: z.string().nullable(),
  email: z.string().email().nullable(),
  avatarUrl: z.string().url().nullable(),
  status: userStatusSchema,
  roles: z.array(roleSchema),
  activeRole: roleSchema.nullable(),
  createdAt: z.string().datetime(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
});

export type UpdateProfile = z.infer<typeof updateProfileSchema>;
