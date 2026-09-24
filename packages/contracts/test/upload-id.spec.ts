import { describe, expect, it } from 'vitest';

import { uploadIdIn, uploadSignatureResponseSchema } from '../src/shared/index.js';
import {
  attachWashPhotoSchema,
  createWasherProfileSchema,
  submitWasherDocumentsSchema,
} from '../src/washer/index.js';

/**
 * One upload-id schema, scoped to the folder the upload was signed for
 * (security M2 + L1, task 14 final fix wave).
 *
 * An upload id is a Cloudinary `public_id`, and `CloudinaryService` signs every
 * upload into `parkease/<folder>/`. So the folder is part of what the id MEANS:
 * a before photo that names `parkease/documents/...` is somebody's ID image
 * being pointed at from the evidence trail, and a business photo that names a
 * proof is a wash photo passed off as a shop front. The shape check alone let
 * both through, and on the profile fields it did not even refuse a URL.
 */

const PROOF = 'parkease/proofs/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const DOCUMENT = 'parkease/documents/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const SHOP_FRONT = 'parkease/spaces/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
const URL_ID = 'https://res.cloudinary.com/demo/image/upload/parkease/proofs/x.jpg';

describe('uploadIdIn', () => {
  const proofs = uploadIdIn('proofs');

  it('takes an id in its own folder', () => {
    expect(proofs.safeParse(PROOF).success).toBe(true);
  });

  it('refuses a URL, even one that contains the right folder', () => {
    expect(proofs.safeParse(URL_ID).success).toBe(false);
  });

  it('refuses an id from another folder', () => {
    expect(proofs.safeParse(DOCUMENT).success).toBe(false);
  });

  it('refuses the bare prefix, which names no upload at all', () => {
    expect(proofs.safeParse('parkease/proofs/').success).toBe(false);
  });

  it('refuses an id that only starts with the folder name, unprefixed', () => {
    expect(proofs.safeParse('proofs/abc').success).toBe(false);
  });

  it('refuses a path that climbs out of its folder', () => {
    expect(proofs.safeParse('parkease/proofs/../documents/abc').success).toBe(false);
  });
});

describe('attachWashPhotoSchema.photoId — proofs', () => {
  it('takes a proof id', () => {
    expect(attachWashPhotoSchema.safeParse({ photoId: PROOF }).success).toBe(true);
  });

  it('refuses a URL', () => {
    expect(attachWashPhotoSchema.safeParse({ photoId: URL_ID }).success).toBe(false);
  });

  it('refuses an id from another folder', () => {
    expect(attachWashPhotoSchema.safeParse({ photoId: DOCUMENT }).success).toBe(false);
  });
});

describe('submitWasherDocumentsSchema', () => {
  it('takes a document id, and business photos from spaces', () => {
    expect(
      submitWasherDocumentsSchema.safeParse({
        idDocumentId: DOCUMENT,
        businessPhotoIds: [SHOP_FRONT],
      }).success,
    ).toBe(true);
  });

  it('refuses a URL as the ID document', () => {
    expect(submitWasherDocumentsSchema.safeParse({ idDocumentId: URL_ID }).success).toBe(false);
  });

  it('refuses an ID document from another folder', () => {
    expect(submitWasherDocumentsSchema.safeParse({ idDocumentId: SHOP_FRONT }).success).toBe(false);
  });

  it('refuses a URL or a wrong-folder id among the business photos', () => {
    for (const bad of [URL_ID, PROOF]) {
      expect(
        submitWasherDocumentsSchema.safeParse({ idDocumentId: DOCUMENT, businessPhotoIds: [bad] })
          .success,
      ).toBe(false);
    }
  });

  /**
   * Task 10 deferred minor. `[]` replaced a business's photos with nothing and
   * still moved it to `pending` — a review of a submission with nothing in it.
   * Absent means "leave the photos alone"; present means at least one.
   */
  it('refuses an empty business photo list, and still allows the field to be absent', () => {
    expect(
      submitWasherDocumentsSchema.safeParse({ idDocumentId: DOCUMENT, businessPhotoIds: [] })
        .success,
    ).toBe(false);
    expect(submitWasherDocumentsSchema.safeParse({ idDocumentId: DOCUMENT }).success).toBe(true);
  });
});

describe('createWasherProfileSchema.businessPhotoIds — spaces', () => {
  const business = (businessPhotoIds: string[]) =>
    createWasherProfileSchema.safeParse({
      partnerType: 'business',
      businessName: 'Shine Co',
      businessPhotoIds,
      capabilities: ['premium_wash'],
    });

  it('takes a spaces id', () => {
    expect(business([SHOP_FRONT]).success).toBe(true);
  });

  it('refuses a URL', () => {
    expect(business([URL_ID]).success).toBe(false);
  });

  it('refuses an id from another folder', () => {
    expect(business([DOCUMENT]).success).toBe(false);
  });
});

describe('uploadSignatureResponseSchema.uploadUrl', () => {
  const signed = (uploadUrl: string) => ({
    uploadUrl,
    publicUrl: 'https://res.cloudinary.com/demo/image/upload/parkease/proofs/x',
    fields: { signature: 'abc' },
    expiresAt: '2026-09-24T10:00:00.000Z',
  });

  /**
   * The client posts the signed fields — api key and signature — to whatever
   * this says. A response that names another host is one that hands our
   * signature to it, so the client refuses anything but Cloudinary's API.
   */
  it('takes Cloudinary’s upload API', () => {
    expect(
      uploadSignatureResponseSchema.safeParse(
        signed('https://api.cloudinary.com/v1_1/demo/image/upload'),
      ).success,
    ).toBe(true);
  });

  it('refuses any other host', () => {
    for (const url of [
      'https://evil.example.com/v1_1/demo/image/upload',
      'http://api.cloudinary.com/v1_1/demo/image/upload',
      'https://api.cloudinary.com.evil.example.com/v1_1/demo/image/upload',
    ]) {
      expect(uploadSignatureResponseSchema.safeParse(signed(url)).success).toBe(false);
    }
  });
});
