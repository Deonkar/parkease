import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { type UploadFolder, uploadIdIn } from '@parkease/contracts/shared';
import { uuidv7 } from '@parkease/db';

import { env } from '../config/env.schema.js';

export interface SignedUploadPayload {
  /** The id Cloudinary stores the upload under, `parkease/<folder>/<uuid>` (S-50 records it). */
  readonly uploadId: string;
  readonly uploadUrl: string;
  readonly publicUrl: string;
  readonly fields: Record<string, string>;
  readonly expiresAt: string;
}

/**
 * How long Cloudinary honours an upload signature: one hour from the signed
 * `timestamp` (Cloudinary Upload API reference, "Generating authentication
 * signatures"). ADR-029 and learnings.md record the same limit, found when a
 * replayed signature failed every retry. `expiresAt` is derived from this and
 * from the SAME `timestamp` that is signed, so the client is never told a
 * window the signature does not actually have. It used to say ten minutes off
 * a second clock read — a number nothing enforced.
 */
const SIGNATURE_VALIDITY_SECONDS = 60 * 60;

/**
 * Folders whose uploads are `authenticated` delivery (S-59): the original and every derived version
 * need a signature. It was `private`, which hides only the original, so a transformed copy of an ID
 * image stayed publicly deliverable. Documents already uploaded as `private` are not converted.
 */
const PRIVATE_FOLDERS = new Set<string>(['documents']);
const PRIVATE_DELIVERY_TYPE = 'authenticated';

/**
 * The shape of an id we minted, one schema per folder: `uploadIdIn` in the contracts, the same one
 * the washer's submit contract applies. A stored id that fails it is not ours (a dev fixture, a
 * value written before the contract tightened) and is never turned into a URL.
 */
const DOCUMENT_ID = uploadIdIn('documents');
const SPACE_PHOTO_ID = uploadIdIn('spaces');

/** A stored upload id that is not shaped like one we minted for the folder it should be in. */
export class InvalidUploadIdError extends Error {
  constructor(folder: UploadFolder) {
    // The id itself stays out of the message: it is stored data and may be anything.
    super(`not an upload id in ${folder}`);
    this.name = 'InvalidUploadIdError';
  }
}

/**
 * How long an admin's document link works. Long enough to open and read an image, short enough that
 * a link pasted into a chat or left in a browser history is already dead.
 */
export const DOCUMENT_URL_TTL_SECONDS = 300;

export interface PrivateDownload {
  readonly url: string;
  readonly expiresAt: string;
}

@Injectable()
export class CloudinaryService {
  createSignedUpload(folder: UploadFolder, contentType: string): SignedUploadPayload {
    const publicId = uuidv7();
    const timestamp = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((timestamp + SIGNATURE_VALIDITY_SECONDS) * 1000).toISOString();

    const folderPath = `parkease/${folder}`;
    const allowedFormats = contentType === 'image/png' ? 'png' : 'jpg';

    const signParams: Record<string, string> = {
      allowed_formats: allowedFormats,
      folder: folderPath,
      /**
       * Cloudinary overwrites by default when a signed upload names a
       * `public_id`, so anybody holding these fields could re-send them with
       * other bytes and swap the image behind an id that is already evidence on
       * a completed wash. Signed, not merely sent: a field outside the
       * signature is one the client can delete.
       */
      overwrite: 'false',
      public_id: publicId,
      timestamp: String(timestamp),
    };

    if (PRIVATE_FOLDERS.has(folder)) {
      signParams['type'] = PRIVATE_DELIVERY_TYPE;
    }

    const signature = this.sign(signParams);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;

    const deliveryType = PRIVATE_FOLDERS.has(folder) ? PRIVATE_DELIVERY_TYPE : 'upload';
    const publicUrl = `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/${deliveryType}/${folderPath}/${publicId}`;

    return {
      uploadId: `${folderPath}/${publicId}`,
      uploadUrl,
      publicUrl,
      fields: {
        ...signParams,
        api_key: env.CLOUDINARY_API_KEY,
        signature,
      },
      expiresAt,
    };
  }

  /**
   * A short-lived signed URL for an `authenticated` document. The parameter set is the official
   * SDK's `private_download_url` (cloudinary_npm `lib/utils`): `timestamp`, `public_id`, `type` and
   * `expires_at` are signed, then `signature` and `api_key` ride along. `format` and `attachment` are
   * blank in the SDK's call and dropped before signing, so they are absent here.
   *
   * `documentId` is what the profile stores, which is Cloudinary's own `public_id` from the upload
   * response — `parkease/documents/<uuid>`. The signature is the admin's key to that image, so it
   * is only given for an id that passes `uploadIdIn('documents')`: the documents folder, and no
   * `.` or `:` to climb out of it or name a URL. Anything else throws `InvalidUploadIdError`
   * before anything is signed.
   */
  privateDownloadUrl(
    documentId: string,
    opts: { readonly expiresInSeconds: number; readonly now?: Date },
  ): PrivateDownload {
    if (!DOCUMENT_ID.safeParse(documentId).success) throw new InvalidUploadIdError('documents');

    const timestamp = Math.floor((opts.now ?? new Date()).getTime() / 1000);
    const expiresAtSeconds = timestamp + opts.expiresInSeconds;

    const signParams: Record<string, string> = {
      expires_at: String(expiresAtSeconds),
      public_id: documentId,
      timestamp: String(timestamp),
      type: PRIVATE_DELIVERY_TYPE,
    };

    const query = new URLSearchParams({
      ...signParams,
      api_key: env.CLOUDINARY_API_KEY,
      signature: this.sign(signParams),
    });

    return {
      url: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/download?${query.toString()}`,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  /**
   * The normal delivery URL for a public image (a business photo, uploaded to `spaces`). It does not
   * expire: unlike a document it was never private. The id must pass `uploadIdIn('spaces')`, the
   * shape the washer contract already enforces on write, so a stored value cannot climb out of the
   * folder or add a query or fragment; anything else throws `InvalidUploadIdError`.
   */
  publicImageUrl(uploadId: string): string {
    if (!SPACE_PHOTO_ID.safeParse(uploadId).success) throw new InvalidUploadIdError('spaces');
    return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/${uploadId}`;
  }

  private sign(params: Record<string, string>): string {
    const sorted = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');

    return createHash('sha256')
      .update(sorted + env.CLOUDINARY_API_SECRET)
      .digest('hex');
  }
}
