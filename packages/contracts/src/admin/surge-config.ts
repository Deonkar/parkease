import { z } from 'zod';

import { rateSchema } from '../primitives/paise.js';

export const updateSurgeConfigSchema = z.object({
  zoneId: z.string().uuid(),
  multiplier: rateSchema,
  reason: z.string().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
});

export type UpdateSurgeConfig = z.infer<typeof updateSurgeConfigSchema>;
