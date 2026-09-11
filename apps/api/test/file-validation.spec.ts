import { PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { describe, it, expect } from 'vitest';

import { assertValidImage } from '../src/platform/storage/file-validation.js';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from('%PDF-1.4');

function makeBuf(magic: Buffer, sizeBytes: number): Buffer {
  const padding = Buffer.alloc(Math.max(0, sizeBytes - magic.length));
  return Buffer.concat([magic, padding]);
}

describe('assertValidImage', () => {
  it('accepts a valid JPEG', async () => {
    const buf = makeBuf(JPEG_MAGIC, 1024);
    const mime = await assertValidImage(buf, 'image/jpeg');
    expect(mime).toBe('image/jpeg');
  });

  it('accepts a valid PNG', async () => {
    const buf = makeBuf(PNG_MAGIC, 1024);
    const mime = await assertValidImage(buf, 'image/png');
    expect(mime).toBe('image/png');
  });

  it('detects a PNG renamed to .jpg and reports actual mime', async () => {
    const buf = makeBuf(PNG_MAGIC, 1024);
    const mime = await assertValidImage(buf, 'image/jpeg');
    expect(mime).toBe('image/png');
  });

  it('rejects a PDF renamed to .jpg', async () => {
    const buf = makeBuf(PDF_MAGIC, 1024);
    await expect(assertValidImage(buf, 'image/jpeg')).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects a file larger than 5MB', async () => {
    const buf = makeBuf(JPEG_MAGIC, 6 * 1024 * 1024);
    await expect(assertValidImage(buf, 'image/jpeg')).rejects.toThrow(PayloadTooLargeException);
  });
});
