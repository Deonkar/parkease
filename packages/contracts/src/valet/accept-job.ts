import { z } from 'zod';

import { valetJobIdSchema } from '../primitives/ids.js';

export const acceptValetJobSchema = z.object({
  jobId: valetJobIdSchema,
});

export type AcceptValetJob = z.infer<typeof acceptValetJobSchema>;
