import type { RequestUploadSignature } from '@parkease/contracts/shared';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { api } from '@/lib/api';

import {
  UPLOAD_COPY,
  UPLOAD_MAX_WIDTH,
  UPLOAD_QUALITY,
  defaultUploadDeps,
  uploadImage,
  type UploadDeps,
  type UploadFolder,
} from '../uploads';

// `../secure-storage` is mocked so a static `import { api } from '@/lib/api'`
// above (needed to drive `defaultUploadDeps` against a real axios instance)
// never evaluates the real `react-native`-touching module — same pattern as
// `api.test.ts`.
vi.mock('../secure-storage', () => ({
  secureStorage: { read: vi.fn(), write: vi.fn(), clear: vi.fn() },
}));

const logged = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../log', () => ({ warn: logged.warn }));

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
      reason: 'offline',
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

  /**
   * T7-I1. The idempotency layer replays a stored sign response for 24h, so a
   * reused sign key hands every retry the same Cloudinary `timestamp` — and
   * Cloudinary refuses a signature over an hour old. Signing has no side effect
   * to deduplicate, so each attempt signs afresh.
   */
  it('signs every attempt under a FRESH key, so a retry never replays a stale signature', async () => {
    const keys: string[] = [];
    const { deps: d } = deps({
      sign: (_input, signIntent) => {
        keys.push(signIntent.idempotencyKey);
        return Promise.resolve(signed);
      },
      put: () => Promise.reject(new Error('offline')),
    });

    await uploadImage('file:///raw.jpg', 'proofs', d);
    await uploadImage('file:///raw.jpg', 'proofs', d);

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails typed rather than throwing when Cloudinary answers without a public_id', async () => {
    const { deps: d } = deps({ put: () => Promise.resolve({ error: 'nope' }) });

    const result = await uploadImage('file:///raw.jpg', 'proofs', d);

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

/**
 * G4: a failed upload says WHY. "Check your connection" over a photo Cloudinary
 * refused, or a phone that could not compress it, sends the partner to fix the
 * wrong thing. Cloudinary's own words go to the warn log, never the screen.
 */
describe('why an upload failed', () => {
  const refusedHttp = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${String(status)}`), {
      isAxiosError: true,
      response: { status, data: { error: { code: 'X', message: 'm', traceId: 't' } } },
    });

  beforeEach(() => {
    logged.warn.mockReset();
  });

  it('is the device when the photo could not be compressed', async () => {
    const { deps: d } = deps({ compress: () => Promise.reject(new Error('no disk')) });
    const result = await uploadImage('file:///raw.jpg', 'proofs', d);
    expect(result).toMatchObject({ ok: false, reason: 'device', message: UPLOAD_COPY.device });
  });

  it('is offline when signing never reached the server, or it answered 5xx', async () => {
    for (const failure of [new Error('Network Error'), refusedHttp(503), refusedHttp(429)]) {
      const { deps: d } = deps({ sign: () => Promise.reject(failure) });
      const result = await uploadImage('file:///raw.jpg', 'proofs', d);
      expect(result).toMatchObject({ ok: false, reason: 'offline' });
    }
  });

  it('is refused when the server said no to the signature, or answered in a shape we cannot read', async () => {
    for (const failure of [refusedHttp(403), new ZodError([])]) {
      const { deps: d } = deps({ sign: () => Promise.reject(failure) });
      const result = await uploadImage('file:///raw.jpg', 'proofs', d);
      expect(result).toMatchObject({ ok: false, reason: 'refused', message: UPLOAD_COPY.refused });
    }
  });

  it('is offline when the PUT never reached Cloudinary', async () => {
    const { deps: d } = deps({
      put: () => Promise.reject(new TypeError('Network request failed')),
    });
    const result = await uploadImage('file:///raw.jpg', 'proofs', d);
    expect(result).toMatchObject({ ok: false, reason: 'offline', message: UPLOAD_COPY.offline });
  });

  it('is refused when Cloudinary answers without a public_id', async () => {
    const { deps: d } = deps({ put: () => Promise.resolve({ error: 'nope' }) });
    const result = await uploadImage('file:///raw.jpg', 'proofs', d);
    expect(result).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('says each reason in its own words, and only offline mentions the connection', () => {
    expect(new Set(Object.values(UPLOAD_COPY)).size).toBe(3);
    expect(UPLOAD_COPY.offline).toMatch(/connection/i);
    expect(UPLOAD_COPY.refused).not.toMatch(/connection/i);
    expect(UPLOAD_COPY.device).not.toMatch(/connection/i);
  });
});

/**
 * K1: the REAL `put`. Everything above injects a fake one, which is how a
 * wrong field name or a dropped signature would reach a device unnoticed.
 */
describe('defaultUploadDeps().put', () => {
  const appended: [string, unknown][] = [];

  class SpyFormData {
    append(key: string, value: unknown) {
      appended.push([key, value]);
    }
  }

  beforeEach(() => {
    appended.length = 0;
    logged.warn.mockReset();
    vi.stubGlobal('FormData', SpyFormData);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends every signed field and the file part, and POSTs them to the signed URL', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ public_id: 'parkease/proofs/abc' }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const answer = await defaultUploadDeps().put(signed.uploadUrl, signed.fields, 'file:///s.jpg');

    for (const [key, value] of Object.entries(signed.fields)) {
      expect(appended).toContainEqual([key, value]);
    }
    expect(appended).toContainEqual([
      'file',
      { uri: 'file:///s.jpg', name: 'upload.jpg', type: 'image/jpeg' },
    ]);
    expect(appended).toHaveLength(Object.keys(signed.fields).length + 1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(signed.uploadUrl);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(SpyFormData);
    expect(answer).toEqual({ public_id: 'parkease/proofs/abc' });
  });

  it('throws on a non-2xx, carrying Cloudinary s own message for the log', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Invalid Signature abc' } }), {
          status: 401,
        }),
      ),
    );

    await expect(
      defaultUploadDeps().put(signed.uploadUrl, signed.fields, 'file:///s.jpg'),
    ).rejects.toThrow(/401.*Invalid Signature abc/);
  });

  it('turns that refusal into refused copy on screen and Cloudinary s words in the log only', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Invalid Signature abc' } }), {
          status: 401,
        }),
      ),
    );
    const real = defaultUploadDeps();
    const result = await uploadImage('file:///raw.jpg', 'proofs', {
      compress: (uri, width) => Promise.resolve({ uri, width, height: 1 }),
      sign: () => Promise.resolve(signed),
      put: real.put,
    });

    expect(result).toMatchObject({ ok: false, reason: 'refused', message: UPLOAD_COPY.refused });
    if (!result.ok) expect(result.message).not.toContain('Invalid Signature');
    // The real `warn` keeps an error's message through its allow-list.
    const loggedMessages = logged.warn.mock.calls.map(([, error]) =>
      error instanceof Error ? error.message : '',
    );
    expect(loggedMessages.join(' ')).toContain('Invalid Signature abc');
  });

  it('still throws a non-2xx whose body is not JSON, and logs that', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('<html>502</html>', { status: 502 })),
    );

    await expect(
      defaultUploadDeps().put(signed.uploadUrl, signed.fields, 'file:///s.jpg'),
    ).rejects.toThrow(/502/);
  });
});

/** I3: the folders and the sign input are the contract's, never a local copy. */
describe('the upload types', () => {
  it('derive from RequestUploadSignature', () => {
    expectTypeOf<UploadFolder>().toEqualTypeOf<RequestUploadSignature['folder']>();
    expectTypeOf<Parameters<UploadDeps['sign']>[0]>().toEqualTypeOf<RequestUploadSignature>();
  });
});
