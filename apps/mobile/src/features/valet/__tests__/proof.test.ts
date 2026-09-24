import { describe, expect, it } from 'vitest';

import { UPLOAD_COPY, UploadError } from '@/lib/upload-failure';

import {
  PROOF_MAX_BYTES,
  PROOF_MAX_WIDTH,
  PROOF_QUALITY,
  submitProof,
  type ProofDeps,
} from '../proof';

const deps = (overrides: Partial<ProofDeps> = {}) => {
  const compressed: unknown[] = [];
  const uploaded: string[] = [];

  const base: ProofDeps = {
    compress: (uri, width, quality) => {
      compressed.push({ uri, width, quality });
      return Promise.resolve({ uri: `${uri}#compressed`, width, height: 900 });
    },
    upload: (uri) => {
      uploaded.push(uri);
      return Promise.resolve('photo_1');
    },
    ...overrides,
  };

  return { deps: base, compressed, uploaded };
};

/**
 * `parking → parked` is where the platform's liability for a car ends and the
 * record of its condition begins, so this path has to work on a basement 3G
 * connection and survive a failure without asking for a second photograph.
 */
describe('submitProof', () => {
  it('compresses before uploading, never the original', async () => {
    const { deps: d, compressed, uploaded } = deps();

    await submitProof('file://shot.jpg', d);

    // A 4MB original on 3G in a basement is the difference between a proof
    // photo and a valet stuck on this screen (R-FE-11).
    expect(compressed).toEqual([
      { uri: 'file://shot.jpg', width: PROOF_MAX_WIDTH, quality: PROOF_QUALITY },
    ]);
    expect(uploaded).toEqual(['file://shot.jpg#compressed']);
  });

  it('returns the photo id the server assigned', async () => {
    const { deps: d } = deps();

    await expect(submitProof('file://shot.jpg', d)).resolves.toEqual({
      ok: true,
      proofPhotoId: 'photo_1',
    });
  });

  it('keeps the captured image when the upload fails', async () => {
    const { deps: d } = deps({
      upload: () => Promise.reject(new Error('network')),
    });

    const result = await submitProof('file://shot.jpg', d);

    // The car is already locked. Discarding the image means a different
    // photograph from a different angle, not a retry of this one.
    expect(result).toMatchObject({ ok: false, retainedUri: 'file://shot.jpg' });
  });

  it('reports the failure in the words the valet needs', async () => {
    const { deps: d } = deps({ upload: () => Promise.reject(new Error('network')) });

    const result = await submitProof('file://shot.jpg', d);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/couldn't upload/i);
      expect(result.message).toMatch(/connection/i);
    }
  });

  it('keeps the original when compression itself fails', async () => {
    const { deps: d } = deps({
      compress: () => Promise.reject(new Error('manipulator exploded')),
    });

    const result = await submitProof('file://shot.jpg', d);

    expect(result).toMatchObject({ ok: false, retainedUri: 'file://shot.jpg' });
  });

  it('caps the upload below the size limit', () => {
    // R-FE-11. Asserted as a constant so a later tweak to quality cannot drift
    // past the limit unnoticed.
    expect(PROOF_MAX_BYTES).toBe(1_000_000);
    expect(PROOF_MAX_WIDTH).toBe(1_200);
    expect(PROOF_QUALITY).toBeLessThanOrEqual(0.7);
  });
});

/** G4: an upload refusal is told as one, not as a dead connection. */
describe('an upload that failed for a known reason', () => {
  it('passes the upload s own copy through', async () => {
    const { deps: d } = deps({
      upload: () => Promise.reject(new UploadError('refused', UPLOAD_COPY.refused)),
    });

    const result = await submitProof('file://shot.jpg', d);

    expect(result).toMatchObject({ ok: false, message: UPLOAD_COPY.refused });
  });
});
