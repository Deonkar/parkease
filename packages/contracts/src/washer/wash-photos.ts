import { z } from 'zod';

import { washJobIdSchema } from '../primitives/ids.js';

export const uploadWashPhotosSchema = z.object({
  jobId: washJobIdSchema,
  beforePhotos: z.array(z.string().url()).max(5).optional(),
  afterPhotos: z.array(z.string().url()).min(1).max(5),
});

export type UploadWashPhotos = z.infer<typeof uploadWashPhotosSchema>;
