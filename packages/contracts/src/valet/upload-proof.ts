import { z } from 'zod';

import { valetJobIdSchema } from '../primitives/ids.js';

export const uploadProofSchema = z.object({
  jobId: valetJobIdSchema,
  imageUrls: z.array(z.string().url()).min(1).max(5),
  notes: z.string().max(500).optional(),
});

export type UploadProof = z.infer<typeof uploadProofSchema>;
