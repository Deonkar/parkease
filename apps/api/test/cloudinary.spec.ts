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
