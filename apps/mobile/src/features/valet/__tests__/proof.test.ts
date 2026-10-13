import { describe, expect, it } from 'vitest';

import { UPLOAD_COPY, UploadError } from '@/lib/upload-failure';

import { submitProof, type ProofDeps } from '../proof';

const deps = (overrides: Partial<ProofDeps> = {}) => {
  const uploaded: string[] = [];

  const base: ProofDeps = {
    upload: (uri) => {
      uploaded.push(uri);
      return Promise.resolve('photo_1');
    },
    ...overrides,
  };

  return { deps: base, uploaded };
};

/**
 * `parking → parked` is where the platform's liability for a car ends and the
 * record of its condition begins, so this path has to work on a basement 3G
 * connection and survive a failure without asking for a second photograph.
 */
describe('submitProof', () => {
  it('uploads the captured photo', async () => {
    const { deps: d, uploaded } = deps();

    await submitProof('file://shot.jpg', d);

    expect(uploaded).toEqual(['file://shot.jpg']);
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
