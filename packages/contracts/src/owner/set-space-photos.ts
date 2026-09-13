import { z } from 'zod';

import { MAX_PHOTOS_PER_SPACE } from './create-space.js';

export const photoItemSchema = z.object({
  publicId: z.string().min(1),
  displayOrder: z.number().int().min(0),
  isPrimary: z.boolean(),
});

export const setSpacePhotosSchema = z.object({
  photos: z
    .array(photoItemSchema)
    .max(MAX_PHOTOS_PER_SPACE)
    .refine((ps) => ps.filter((p) => p.isPrimary).length <= 1, {
      message: 'At most one photo can be primary',
    }),
});

export type SetSpacePhotos = z.infer<typeof setSpacePhotosSchema>;
export type PhotoItem = z.infer<typeof photoItemSchema>;
