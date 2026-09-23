import MockAdapter from 'axios-mock-adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import {
  UPLOAD_MAX_WIDTH,
  UPLOAD_QUALITY,
  defaultUploadDeps,
  uploadImage,
  type UploadDeps,
} from '../uploads';

// `../secure-storage` is mocked so a static `import { api } from '@/lib/api'`
// above (needed to drive `defaultUploadDeps` against a real axios instance)
// never evaluates the real `react-native`-touching module — same pattern as
// `api.test.ts`.
vi.mock('../secure-storage', () => ({
  secureStorage: { read: vi.fn(), write: vi.fn(), clear: vi.fn() },
}));

const signed = {
  uploadUrl: 'https://api.cloudinary.com/v1_1/demo/image/upload',
  publicUrl: 'https://res.cloudinary.com/demo/image/upload/parkease/proofs/abc',
  fields: { api_key: 'k', signature: 's', folder: 'parkease/proofs', public_id: 'abc' },
  expiresAt: '2026-09-23T06:10:00.000Z',
};

const intent = { idempotencyKey: '018f5e2a-0000-7000-8000-000000000001' };

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

    const result = await uploadImage('file:///raw.jpg', 'proofs', intent, d);

    expect(compressed).toEqual([
      { uri: 'file:///raw.jpg', width: UPLOAD_MAX_WIDTH, quality: UPLOAD_QUALITY },
    ]);
    // The COMPRESSED uri is what goes over the wire, never the original.
    expect(put[0]?.uri).toBe('file:///raw.jpg#small');
    expect(result).toEqual({ ok: true, uploadId: 'parkease/proofs/abc' });
  });

  it('returns the upload id, never a URL — the API contract refuses a URL', async () => {
    const { deps: d } = deps();
    const result = await uploadImage('file:///raw.jpg', 'proofs', intent, d);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.uploadId).toMatch(/^[A-Za-z0-9_\-/]+$/);
  });

  it('retains the ORIGINAL uri when the upload fails, so a retry needs no second photo', async () => {
    const { deps: d } = deps({ put: () => Promise.reject(new Error('offline')) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', intent, d);

    expect(result).toEqual({
      ok: false,
      message: "Couldn't upload the photo. Check your connection.",
      retainedUri: 'file:///raw.jpg',
    });
  });

  it('retains the original uri when SIGNING fails too', async () => {
    const { deps: d } = deps({ sign: () => Promise.reject(new Error('401')) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', intent, d);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retainedUri).toBe('file:///raw.jpg');
  });

  it('fails typed rather than throwing when Cloudinary answers without a public_id', async () => {
    const { deps: d } = deps({ put: () => Promise.resolve({ error: 'nope' }) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', intent, d);

    expect(result.ok).toBe(false);
  });
});

/**
 * All five tests above inject fakes for `sign` — none of them touches the
 * real device implementation `defaultUploadDeps()` builds. That is exactly
 * how the CRITICAL finding got through review: `defaultUploadDeps().sign`
 * sent no `Idempotency-Key`, so every real upload threw at the sign step
 * before it ever reached the network, and nothing here noticed.
 *
 * This suite drives the real `api` instance (mocked at the transport layer
 * only, via `axios-mock-adapter`) so `lib/api.ts`'s own request interceptor
 * — the thing that actually enforces the header — runs for real.
 */
describe('defaultUploadDeps', () => {
  const mock = new MockAdapter(api);

  beforeEach(() => {
    mock.reset();
  });

  it('sets an Idempotency-Key header on the sign request', async () => {
    let capturedHeader: unknown;
    mock.onPost('/me/upload-signature').reply((config) => {
      capturedHeader = config.headers?.['Idempotency-Key'];
      return [200, { data: signed }];
    });

    const result = await defaultUploadDeps().sign(
      { fileName: 'proofs.jpg', contentType: 'image/jpeg', folder: 'proofs' },
      intent,
    );

    expect(capturedHeader).toBe(intent.idempotencyKey);
    expect(result).toEqual(signed);
  });
});
