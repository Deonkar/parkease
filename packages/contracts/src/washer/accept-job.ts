import { z } from 'zod';

import { washJobIdSchema } from '../primitives/ids.js';

export const acceptWashJobSchema = z.object({
  jobId: washJobIdSchema,
});

export type AcceptWashJob = z.infer<typeof acceptWashJobSchema>;
