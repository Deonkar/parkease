import { z } from 'zod';

import { roleSchema } from '../enums/role.js';

export const switchActiveRoleSchema = z.object({
  role: roleSchema,
});

export type SwitchActiveRole = z.infer<typeof switchActiveRoleSchema>;

/**
 * The roles a person may give themselves (S-149). `driver` every account starts with; `admin` is
 * only ever granted by another admin.
 */
export const SELF_SERVE_ROLE_VALUES = ['owner', 'valet', 'washer'] as const;

export const selfServeRoleSchema = z.object({ role: z.enum(SELF_SERVE_ROLE_VALUES) });

export type SelfServeRole = z.infer<typeof selfServeRoleSchema>;

/**
 * What a role change answers: a fresh session for the new active role, and the roles it carries,
 * so the client never has to guess either.
 */
export const roleSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  roles: z.array(roleSchema),
  activeRole: roleSchema,
});

export type RoleSession = z.infer<typeof roleSessionSchema>;
