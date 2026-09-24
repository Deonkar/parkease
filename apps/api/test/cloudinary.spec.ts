import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { CloudinaryService } from '../src/platform/storage/cloudinary.service.js';

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

  it('uses private delivery type for documents', () => {
    const result = service.createSignedUpload('documents', 'image/jpeg');
    expect(result.publicUrl).toContain('/private/');
    expect(result.fields['type']).toBe('private');
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
