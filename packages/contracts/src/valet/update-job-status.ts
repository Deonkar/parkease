import { z } from 'zod';

import { valetJobStatusSchema } from '../enums/valet-job-status.js';
import { valetJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';

export const updateValetJobStatusSchema = z.object({
  jobId: valetJobIdSchema,
  status: valetJobStatusSchema,
  location: geoPointSchema.optional(),
});

export type UpdateValetJobStatus = z.infer<typeof updateValetJobStatusSchema>;
