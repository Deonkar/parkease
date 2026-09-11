import { z } from 'zod';

import { carwashJobStatusSchema } from '../enums/carwash-job-status.js';
import { washJobIdSchema } from '../primitives/ids.js';

export const updateWashJobStatusSchema = z.object({
  jobId: washJobIdSchema,
  status: carwashJobStatusSchema,
});

export type UpdateWashJobStatus = z.infer<typeof updateWashJobStatusSchema>;
