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

const PRIVATE_FOLDERS = new Set<string>(['documents']);

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
      signParams['type'] = 'private';
    }

    const signature = this.sign(signParams);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;

    const deliveryType = PRIVATE_FOLDERS.has(folder) ? 'private' : 'upload';
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
