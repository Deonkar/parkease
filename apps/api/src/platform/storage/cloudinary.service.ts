import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { UploadFolder } from '@parkease/contracts/shared';
import { uuidv7 } from '@parkease/db';

import { env } from '../config/env.schema.js';

export interface SignedUploadPayload {
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

const DOCUMENTS_PREFIX = 'parkease/documents/';
const SPACES_PREFIX = 'parkease/spaces/';

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
   * response — `parkease/documents/<uuid>`. A bare id is placed in the documents folder, and an id
   * naming any other folder is nested under it rather than followed, so a stored value can never
   * make an admin's signature unlock something outside `parkease/documents`.
   */
  privateDownloadUrl(
    documentId: string,
    opts: { readonly expiresInSeconds: number; readonly now?: Date },
  ): PrivateDownload {
    const timestamp = Math.floor((opts.now ?? new Date()).getTime() / 1000);
    const expiresAtSeconds = timestamp + opts.expiresInSeconds;

    const signParams: Record<string, string> = {
      expires_at: String(expiresAtSeconds),
      public_id: documentId.startsWith(DOCUMENTS_PREFIX)
        ? documentId
        : `${DOCUMENTS_PREFIX}${documentId}`,
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
   * expire: unlike a document it was never private. Each path segment is encoded, so a stored id
   * cannot add a query or fragment to the URL.
   */
  publicImageUrl(uploadId: string): string {
    const publicId = uploadId.startsWith('parkease/') ? uploadId : `${SPACES_PREFIX}${uploadId}`;
    const path = publicId.split('/').map(encodeURIComponent).join('/');
    return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/${path}`;
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
