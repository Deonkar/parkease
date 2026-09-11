import { z } from 'zod';

import { roleSchema } from '../enums/role.js';
import { verificationStatusSchema } from '../enums/verification-status.js';
import { userIdSchema } from '../primitives/ids.js';

export const verifyPartnerSchema = z.object({
  userId: userIdSchema,
  role: roleSchema,
  status: verificationStatusSchema,
  notes: z.string().max(500).optional(),
});

export type VerifyPartner = z.infer<typeof verifyPartnerSchema>;
