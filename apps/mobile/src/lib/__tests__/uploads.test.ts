import { describe, expect, it } from 'vitest';

import { UPLOAD_MAX_WIDTH, UPLOAD_QUALITY, uploadImage, type UploadDeps } from '../uploads';

const signed = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
  publicUrl: 'https://res.cloudinary.com/demo/image/upload/parkease/proofs/abc',
  fields: { api_key: 'k', signature: 's', folder: 'parkease/proofs', public_id: 'abc' },
  expiresAt: '2026-09-23T06:10:00.000Z',
};

function deps(overrides: Partial<UploadDeps> = {}) {
  const compressed: { uri: string; width: number; quality: number }[] = [];
  const put: { uploadUrl: string; uri: string }[] = [];

  const base: UploadDeps = {
    compress: (uri, width, quality) => {
      compressed.push({ uri, width, quality });
      return Promise.resolve({ uri: `${uri}#small`, width, height: 800 });
    },
    sign: () => Promise.resolve(signed),
    put: (uploadUrl, _fields, uri) => {
      put.push({ uploadUrl, uri });
      return Promise.resolve({ public_id: 'parkease/proofs/abc' });
    },
    ...overrides,
  };

  return { deps: base, compressed, put };
}

describe('uploadImage', () => {
  it('compresses before it uploads, at the R-FE-11 limits', async () => {
    const { deps: d, compressed, put } = deps();

    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(compressed).toEqual([
      { uri: 'file:///raw.jpg', width: UPLOAD_MAX_WIDTH, quality: UPLOAD_QUALITY },
    ]);
    // The COMPRESSED uri is what goes over the wire, never the original.
    expect(put[0]?.uri).toBe('file:///raw.jpg#small');
    expect(result).toEqual({ ok: true, uploadId: 'parkease/proofs/abc' });
  });

  it('returns the upload id, never a URL — the API contract refuses a URL', async () => {
    const { deps: d } = deps();
    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uploadId).toMatch(/^[A-Za-z0-9_\-/]+$/);
  });

  it('retains the ORIGINAL uri when the upload fails, so a retry needs no second photo', async () => {
    const { deps: d } = deps({ put: () => Promise.reject(new Error('offline')) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(result).toEqual({
      ok: false,
      message: "Couldn't upload the photo. Check your connection.",
      retainedUri: 'file:///raw.jpg',
    });
  });

  it('retains the original uri when SIGNING fails too', async () => {
    const { deps: d } = deps({ sign: () => Promise.reject(new Error('401')) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retainedUri).toBe('file:///raw.jpg');
  });

  it('fails typed rather than throwing when Cloudinary answers without a public_id', async () => {
    const { deps: d } = deps({ put: () => Promise.resolve({ error: 'nope' }) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(result.ok).toBe(false);
  });
});
