import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type Harness,
  registerUploads,
  seedSpace,
  seedUser,
  startHarness,
  stopHarness,
} from './harness.js';
import { actingAs, type HttpApp, startHttpApp, stopHttpApp } from './http-harness.js';

/**
 * S-50: an upload id is accepted only if the API signed it for the caller. `uploadIdIn` proves the
 * shape and the folder; this proves the caller is the one who was given it. Each attach endpoint
 * that takes one is covered: a made-up id and another user's id are both refused, with one answer.
 */
describe('upload ownership', () => {
  let h: Harness;
  let http: HttpApp;

  beforeAll(async () => {
    h = await startHarness();
    http = await startHttpApp(h);
  }, 300_000);

  afterAll(async () => {
    await stopHttpApp(http);
    await stopHarness(h);
  });

  beforeEach(async () => {
    await h.sql`TRUNCATE uploads`;
  });

  const as = (id: string, role: 'washer' | 'owner' | 'valet') => {
    actingAs.user = { id, roles: [role], activeRole: role };
  };
  const post = (url: string, payload: unknown) =>
    http.request({
      method: 'POST',
      url,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload,
    });
  const code = (body: unknown) => (body as { error?: { code?: string } }).error?.code;

  it('records the id it signs, for the caller, in the folder asked for', async () => {
    const washer = await seedUser(h, 'washer');
    as(washer, 'washer');

    const res = await post('/api/v1/me/upload-signature', {
      fileName: 'front.jpg',
      contentType: 'image/jpeg',
      folder: 'documents',
    });

    expect(res.status).toBe(200);
    const { uploadId } = (res.body as { data: { uploadId: string } }).data;
    expect(uploadId).toMatch(/^parkease\/documents\/[0-9a-f-]{36}$/);
    const rows = await h.sql<{ user_id: string; folder: string }[]>`
      SELECT user_id, folder FROM uploads WHERE public_id = ${uploadId}`;
    expect(rows).toEqual([{ user_id: washer, folder: 'documents' }]);
  });

  describe('a washer registering', () => {
    it('is refused a business photo id nobody signed', async () => {
      const washer = await seedUser(h, 'washer');
      as(washer, 'washer');

      const res = await post('/api/v1/washer/profile', {
        partnerType: 'business',
        businessName: 'SparkleWash',
        businessPhotoIds: ['parkease/spaces/0190made-up'],
        capabilities: ['premium_wash'],
      });

      expect(res.status).toBe(422);
      expect(code(res.body)).toBe('UPLOAD_NOT_RECOGNISED');
    });

    it("is refused another partner's ID document, and stays unverified", async () => {
      const washer = await seedUser(h, 'washer');
      const other = await seedUser(h, 'washer');
      await registerUploads(h, other, 'parkease/documents/0190someone-else');
      as(washer, 'washer');
      expect(
        (
          await post('/api/v1/washer/profile', {
            partnerType: 'gig',
            businessName: 'Raju M.',
            capabilities: ['premium_wash'],
          })
        ).status,
      ).toBe(201);

      const res = await post('/api/v1/washer/profile/documents', {
        idDocumentId: 'parkease/documents/0190someone-else',
      });

      expect(res.status).toBe(422);
      expect(code(res.body)).toBe('UPLOAD_NOT_RECOGNISED');
      const [profile] = await h.sql<{ verification_status: string }[]>`
        SELECT verification_status FROM washer_profiles WHERE user_id = ${washer}`;
      expect(profile?.verification_status).toBe('unverified');
    });

    it('accepts its own document and moves to review', async () => {
      const washer = await seedUser(h, 'washer');
      await registerUploads(h, washer, 'parkease/documents/0190mine');
      as(washer, 'washer');
      await post('/api/v1/washer/profile', {
        partnerType: 'gig',
        businessName: 'Raju M.',
        capabilities: ['premium_wash'],
      });

      const res = await post('/api/v1/washer/profile/documents', {
        idDocumentId: 'parkease/documents/0190mine',
      });

      expect(res.status).toBe(201);
    });
  });

  describe('an owner setting space photos', () => {
    it('is refused a photo id signed for someone else', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      const stranger = await seedUser(h, 'owner');
      await registerUploads(h, stranger, 'parkease/spaces/0190strangers');
      as(h.ownerId, 'owner');

      const res = await post(`/api/v1/owner/spaces/${spaceId}/photos`, {
        photos: [{ publicId: 'parkease/spaces/0190strangers', displayOrder: 0, isPrimary: true }],
      });

      expect(res.status).toBe(422);
      expect(code(res.body)).toBe('UPLOAD_NOT_RECOGNISED');
    });

    it('accepts its own photo', async () => {
      const spaceId = await seedSpace(h, { lat: 12.9345, lng: 77.6266, carSlots: 1 });
      await registerUploads(h, h.ownerId, 'parkease/spaces/0190own');
      as(h.ownerId, 'owner');

      const res = await post(`/api/v1/owner/spaces/${spaceId}/photos`, {
        photos: [{ publicId: 'parkease/spaces/0190own', displayOrder: 0, isPrimary: true }],
      });

      expect(res.status).toBeLessThan(300);
    });
  });
});
