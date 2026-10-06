import { z } from 'zod';

import { roleStatusSchema } from '../enums/role-status.js';
import { roleSchema } from '../enums/role.js';
import { userStatusSchema } from '../enums/user-status.js';
import { userIdSchema } from '../primitives/ids.js';

import { adminPageQuerySchema } from './query.js';

export const adminUsersQuerySchema = adminPageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
});

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const adminUserRoleSchema = z.object({
  role: roleSchema,
  status: roleStatusSchema,
  grantedAt: z.string().datetime(),
});

export type AdminUserRole = z.infer<typeof adminUserRoleSchema>;

export const adminUserSchema = z.object({
  id: userIdSchema,
  name: z.string().nullable(),
  /** Always `maskPhone` output; an admin screen never holds a callable number. */
  phone: z.string(),
  status: userStatusSchema,
  roles: z.array(adminUserRoleSchema),
  createdAt: z.string().datetime(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

/** Every admin mutation on a person is audited with why. */
const reasonField = z.string().trim().min(1).max(500);

export const grantRoleSchema = z.object({
  role: roleSchema,
  reason: reasonField,
});

export type GrantRole = z.infer<typeof grantRoleSchema>;

/** Revoke, block, unblock and cancel all take just a reason. */
export const reasonSchema = z.object({ reason: reasonField });

export type Reason = z.infer<typeof reasonSchema>;
