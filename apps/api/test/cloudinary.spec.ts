import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import {
  CloudinaryService,
  DOCUMENT_URL_TTL_SECONDS,
} from '../src/platform/storage/cloudinary.service.js';

describe('CloudinaryService', () => {
  const service = new CloudinaryService();

  it('produces a UUID public_id, not the client filename', () => {
    const result = service.createSignedUpload('spaces', 'image/jpeg');
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(result.fields['public_id']).toMatch(uuidPattern);
  });

  it('never exposes the Cloudinary API secret in the response', () => {
    const result = service.createSignedUpload('avatars', 'image/png');
    const json = JSON.stringify(result);
    expect(json).not.toContain('fake_cloudinary_secret');
    expect(Object.keys(result.fields)).not.toContain('api_secret');
  });

  /**
   * S-59. A `private` asset hides only its original: transformed (derived) versions
   * stay publicly deliverable. `authenticated` requires a signature for the original
   * and every derived version, which is what an ID document needs.
   */
  it('uploads documents as authenticated, never private', () => {
    const result = service.createSignedUpload('documents', 'image/jpeg');
    expect(result.publicUrl).toContain('/authenticated/');
    expect(result.fields['type']).toBe('authenticated');
  });

  it('uses upload delivery type for non-document folders', () => {
    const result = service.createSignedUpload('spaces', 'image/jpeg');
    expect(result.publicUrl).toContain('/upload/');
    expect(result.fields['type']).toBeUndefined();
  });

  it('includes a valid expiration', () => {
    const result = service.createSignedUpload('avatars', 'image/png');
    const expiry = new Date(result.expiresAt);
    expect(expiry.getTime()).toBeGreaterThan(Date.now());
  });

  it('includes api_key and signature in fields', () => {
    const result = service.createSignedUpload('spaces', 'image/jpeg');
    expect(result.fields['api_key']).toBeDefined();
    expect(result.fields['signature']).toBeDefined();
    expect(result.fields['signature']!.length).toBeGreaterThan(0);
  });
});

/**
 * Security M1 (task 14 final fix wave). Cloudinary OVERWRITES by default when a
 * signed upload names a `public_id`, so anybody holding a set of signed fields —
 * a retry queue, a proxy log — could re-send them with different bytes and
 * swap the image behind an id that is already evidence on a completed wash.
 * `overwrite=false` has to be inside the signature: a field added after
 * signing is one the client can simply delete.
 */
describe('CloudinaryService — a signed upload cannot replace an existing image', () => {
  const service = new CloudinaryService();

  /** Cloudinary's scheme: sorted `k=v` pairs joined by `&`, secret appended, SHA-256. */
  const expectedSignature = (fields: Record<string, string>): string => {
    const signed = Object.entries(fields)
      .filter(([k]) => k !== 'api_key' && k !== 'signature')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return createHash('sha256')
      .update(signed + String(process.env['CLOUDINARY_API_SECRET']))
      .digest('hex');
  };

  it('sends overwrite=false, and signs it', () => {
    for (const folder of ['proofs', 'documents', 'spaces'] as const) {
      const { fields } = service.createSignedUpload(folder, 'image/jpeg');

      expect(fields['overwrite']).toBe('false');
      // The signature covers every field but the key and itself — so it
      // covers overwrite, and a client that drops it breaks the signature.
      expect(fields['signature']).toBe(expectedSignature(fields));
    }
  });

  /**
   * Cloudinary honours an upload signature for one hour from its `timestamp`
   * (Upload API reference; ADR-029 and learnings.md record the same limit, found
   * the hard way). `expiresAt` is derived from that `timestamp`, not from a
   * second clock read, so the client is never told a window the server did not
   * sign for.
   */
  it('expires one hour after the signed timestamp', () => {
    const { fields, expiresAt } = service.createSignedUpload('proofs', 'image/jpeg');

    expect(new Date(expiresAt).getTime()).toBe((Number(fields['timestamp']) + 3600) * 1000);
  });
});

/**
 * Admin partner review (task 18a, S-59). Identity documents are `authenticated`, so the only way
 * to look at one is a download URL signed for a few minutes. The parameter set mirrors the
 * official SDK's `private_download_url` (cloudinary_npm `lib/utils`): it signs `timestamp`,
 * `public_id`, `type` and `expires_at` (`format` and `attachment` are blank and dropped).
 */
describe('CloudinaryService.privateDownloadUrl', () => {
  const service = new CloudinaryService();
  const now = new Date('2026-10-06T10:00:00.000Z');
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const cloud = String(process.env['CLOUDINARY_CLOUD_NAME']);
  const secret = String(process.env['CLOUDINARY_API_SECRET']);

  const paramsOf = (url: string): URLSearchParams => new URL(url).searchParams;

  it('is a five-minute window', () => {
    expect(DOCUMENT_URL_TTL_SECONDS).toBe(300);
  });

  it('points at the Cloudinary download API for the account', () => {
    const { url } = service.privateDownloadUrl('x', { expiresInSeconds: 300, now });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://api.cloudinary.com');
    expect(parsed.pathname).toBe(`/v1_1/${cloud}/image/download`);
  });

  it('signs expires_at, public_id, timestamp and type=authenticated', () => {
    const { url, expiresAt } = service.privateDownloadUrl('x', { expiresInSeconds: 300, now });
    const params = paramsOf(url);

    expect(params.get('expires_at')).toBe(String(nowSeconds + 300));
    expect(params.get('timestamp')).toBe(String(nowSeconds));
    expect(params.get('type')).toBe('authenticated');
    expect(params.get('public_id')).toBe('parkease/documents/x');
    expect(params.get('api_key')).toBe(process.env['CLOUDINARY_API_KEY']);
    expect(new Date(expiresAt).getTime()).toBe((nowSeconds + 300) * 1000);
  });

  it('carries a signature equal to sha256 over the sorted signed set plus the secret', () => {
    const { url } = service.privateDownloadUrl('x', { expiresInSeconds: 300, now });

    const signed = [
      `expires_at=${String(nowSeconds + 300)}`,
      'public_id=parkease/documents/x',
      `timestamp=${String(nowSeconds)}`,
      'type=authenticated',
    ].join('&');
    const expected = createHash('sha256')
      .update(signed + secret)
      .digest('hex');

    expect(paramsOf(url).get('signature')).toBe(expected);
  });

  it('never puts the API secret in the URL', () => {
    const { url } = service.privateDownloadUrl('x', { expiresInSeconds: 300, now });

    expect(url).not.toContain(secret);
    expect(paramsOf(url).has('api_secret')).toBe(false);
  });

  it('takes the id as stored: a full documents public_id is not prefixed twice', () => {
    const { url } = service.privateDownloadUrl('parkease/documents/abc-123', {
      expiresInSeconds: 300,
      now,
    });

    expect(paramsOf(url).get('public_id')).toBe('parkease/documents/abc-123');
  });

  it('cannot be pointed at another folder through the id', () => {
    const { url } = service.privateDownloadUrl('parkease/proofs/abc', {
      expiresInSeconds: 300,
      now,
    });

    expect(paramsOf(url).get('public_id')).toBe('parkease/documents/parkease/proofs/abc');
  });

  it('does not throw on a dev-mock id', () => {
    expect(() =>
      service.privateDownloadUrl('dev-mock-licence', { expiresInSeconds: 300, now }),
    ).not.toThrow();
  });
});

describe('CloudinaryService.publicImageUrl', () => {
  const service = new CloudinaryService();
  const cloud = String(process.env['CLOUDINARY_CLOUD_NAME']);

  it('is the normal upload delivery URL for a stored spaces id', () => {
    expect(service.publicImageUrl('parkease/spaces/abc')).toBe(
      `https://res.cloudinary.com/${cloud}/image/upload/parkease/spaces/abc`,
    );
  });

  it('puts a bare id into the spaces folder', () => {
    expect(service.publicImageUrl('abc')).toContain('/image/upload/parkease/spaces/abc');
  });

  it('percent-encodes each segment so an id cannot break out of the path', () => {
    expect(service.publicImageUrl('parkease/spaces/a b?c#d')).toContain(
      '/parkease/spaces/a%20b%3Fc%23d',
    );
  });
});
