import { z } from 'zod';

export const requestUploadSignatureSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  folder: z.enum(['spaces', 'documents', 'avatars', 'reviews', 'proofs']),
});

export type RequestUploadSignature = z.infer<typeof requestUploadSignatureSchema>;

export const uploadSignatureResponseSchema = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export type UploadSignatureResponse = z.infer<typeof uploadSignatureResponseSchema>;
