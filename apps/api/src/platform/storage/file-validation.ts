import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';

import { logger } from '../observability/logger.js';

const ALLOWED = new Set(['image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

export async function assertValidImage(buffer: Buffer, declaredMime: string): Promise<string> {
  if (buffer.byteLength > MAX_BYTES) {
    throw new PayloadTooLargeException('Images must be 5MB or smaller.');
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED.has(detected.mime)) {
    throw new UnsupportedMediaTypeException('Only JPEG and PNG images are supported.');
  }

  if (detected.mime !== declaredMime) {
    logger.warn({ declaredMime, detected: detected.mime }, 'upload mime mismatch');
  }

  return detected.mime;
}
