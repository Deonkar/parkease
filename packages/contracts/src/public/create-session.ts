import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { indianPhoneSchema } from '../primitives/indian.js';

export const createSessionSchema = z.object({
  phone: indianPhoneSchema,
  firebaseToken: z.string().min(1),
});

export type CreateSession = z.infer<typeof createSessionSchema>;

export const sessionResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
  roles: z.array(roleSchema),
  activeRole: roleSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
