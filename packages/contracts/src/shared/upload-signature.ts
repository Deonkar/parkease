import { z } from 'zod';

export const requestUploadSignatureSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  folder: z.enum(['spaces', 'documents', 'avatars', 'reviews', 'proofs']),
});

export type RequestUploadSignature = z.infer<typeof requestUploadSignatureSchema>;

/**
 * The signed payload, exactly as `CloudinaryService.createSignedUpload` returns it.
 *
 * `fields` was missing until task 14 and the omission was silent: a client that
 * parsed this response strictly threw away the signature, the api key and the
 * public id — everything that makes the upload authorised — and was left with
 * two URLs it could do nothing with.
 */
export const uploadSignatureResponseSchema = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  fields: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});

export type UploadSignatureResponse = z.infer<typeof uploadSignatureResponseSchema>;
