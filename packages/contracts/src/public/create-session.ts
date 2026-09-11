import { z } from 'zod';

import { roleSchema } from '../enums/role.js';

export const createSessionSchema = z.object({
  idToken: z.string().min(1),
});

export type CreateSession = z.infer<typeof createSessionSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  roles: z.array(roleSchema),
  activeRole: roleSchema.nullable(),
  isNewUser: z.boolean(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
