import { z } from 'zod';

/**
 * The before or the after photo, as an upload id.
 *
 * One id, not an array: §13.8 has exactly two photos on a job and two endpoints
 * to attach them, so a list would only ever be a list of one with a rule about
 * which element counts.
 *
 * An upload id and never a URL. Files go through `POST /uploads`, which
 * validates magic bytes rather than trusting a content type (R-VAL-01) and
 * stores to Cloudinary with private delivery. Accepting a client-supplied URL
 * would let a partner point the proof trail at any image on the internet —
 * which is the whole evidentiary value of a before/after pair, gone.
 */
export const attachWashPhotoSchema = z.object({
  photoId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_\-/]+$/, 'an upload id, not a URL'),
});

export type AttachWashPhoto = z.infer<typeof attachWashPhotoSchema>;
