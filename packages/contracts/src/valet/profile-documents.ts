import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  documentType: z.enum(['driving_license', 'aadhaar', 'pan', 'vehicle_rc']),
  imageUrl: z.string().url(),
});

export type UploadDocument = z.infer<typeof uploadDocumentSchema>;
