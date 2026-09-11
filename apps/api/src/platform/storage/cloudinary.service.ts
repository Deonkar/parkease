import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@parkease/db';

import { env } from '../config/env.schema.js';

export interface SignedUploadPayload {
  readonly uploadUrl: string;
  readonly publicUrl: string;
  readonly fields: Record<string, string>;
  readonly expiresAt: string;
}

type UploadFolder = 'spaces' | 'documents' | 'avatars' | 'reviews' | 'proofs';

const PRIVATE_FOLDERS = new Set<string>(['documents']);

@Injectable()
export class CloudinaryService {
  createSignedUpload(folder: UploadFolder, contentType: string): SignedUploadPayload {
    const publicId = uuidv7();
    const timestamp = Math.floor(Date.now() / 1000);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const folderPath = `parkease/${folder}`;
    const allowedFormats = contentType === 'image/png' ? 'png' : 'jpg';

    const signParams: Record<string, string> = {
      allowed_formats: allowedFormats,
      folder: folderPath,
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
