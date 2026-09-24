import { z } from 'zod';

/** Every folder `CloudinaryService` signs uploads into, under `parkease/`. */
export const UPLOAD_FOLDER_VALUES = [
  'spaces',
  'documents',
  'avatars',
  'reviews',
  'proofs',
] as const;
export const uploadFolderSchema = z.enum(UPLOAD_FOLDER_VALUES);
export type UploadFolder = z.infer<typeof uploadFolderSchema>;

export const requestUploadSignatureSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  folder: uploadFolderSchema,
});

export type RequestUploadSignature = z.infer<typeof requestUploadSignatureSchema>;

/**
 * The characters a Cloudinary `public_id` we minted can contain: a uuid, the
 * folder path's slashes, nothing else. No `:` and no `.` — so neither a URL nor
 * a `..` segment can pass.
 */
const UPLOAD_ID = /^[A-Za-z0-9_\-/]+$/;

/**
 * An upload id, and the folder it must have been signed into.
 *
 * `CloudinaryService` signs every upload as `parkease/<folder>/<uuid>`, so the
 * folder is part of what an id means: a before photo naming
 * `parkease/documents/...` points the evidence trail at somebody's ID image, and
 * a shop-front photo naming a proof is a wash photo passed off as a business.
 * The shape check alone let both through. Extracted on its fourth use (wash
 * photo, ID document, business photos, valet proof — R-ARCH-07): the call sites
 * must change together, because the id format is one fact about one signer.
 *
 * This proves the id is well-formed and in the right folder. It does NOT prove
 * the upload exists or that the caller made it — suggestedtask.md S-50.
 */
export const uploadIdIn = (folder: UploadFolder) =>
  z
    .string()
    .min(1)
    .max(255)
    .regex(UPLOAD_ID, 'an upload id, not a URL')
    .regex(new RegExp(`^parkease/${folder}/[A-Za-z0-9_-]`), `an upload id in ${folder}`);

/**
 * The only host a signed upload may be sent to.
 *
 * The client posts the api key and the signature to whatever `uploadUrl` says,
 * so a response naming another host is one that hands our signature to it.
 * Pinned with the trailing path segment, so `api.cloudinary.com.evil.example`
 * does not match on a prefix.
 */
const CLOUDINARY_UPLOAD_API = 'https://api.cloudinary.com/v1_1/';

/**
 * The signed payload, exactly as `CloudinaryService.createSignedUpload` returns it.
 *
 * `fields` was missing until task 14 and the omission was silent: a client that
 * parsed this response strictly threw away the signature, the api key and the
 * public id — everything that makes the upload authorised — and was left with
 * two URLs it could do nothing with.
 */
export const uploadSignatureResponseSchema = z.object({
  uploadUrl: z
    .string()
    .url()
    .startsWith(CLOUDINARY_UPLOAD_API, 'an upload URL on Cloudinary’s API'),
  publicUrl: z.string().url(),
  fields: z.record(z.string(), z.string()),
  expiresAt: z.string().datetime(),
});

export type UploadSignatureResponse = z.infer<typeof uploadSignatureResponseSchema>;
