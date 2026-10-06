import type { PartnerDocument } from '@parkease/contracts/admin';

import type { PartnerDocumentIds } from '../../../domains/identity/partner.queries.js';
import {
  type CloudinaryService,
  DOCUMENT_URL_TTL_SECONDS,
} from '../../../platform/storage/cloudinary.service.js';

/**
 * The links an admin reviews a partner by.
 *
 * An ID document or licence is `authenticated`, so its link is signed for five minutes and the
 * response says exactly when it dies. A business photo is the public image drivers see, so its link
 * is the ordinary delivery URL and has no expiry. Each call mints fresh links: nothing here is
 * stored, so a link from yesterday's screen is already dead and never reissued.
 *
 * An id that points at nothing (a dev fixture, a document uploaded before the switch to
 * `authenticated`) still produces a link; it answers 404 at Cloudinary, which is where that fact
 * belongs.
 */
export function partnerDocumentsOf(
  storage: CloudinaryService,
  ids: PartnerDocumentIds,
  now: Date = new Date(),
): PartnerDocument[] {
  const signed = (kind: 'driving_licence' | 'id_proof', id: string): PartnerDocument => {
    const { url, expiresAt } = storage.privateDownloadUrl(id, {
      expiresInSeconds: DOCUMENT_URL_TTL_SECONDS,
      now,
    });
    return { kind, url, expiresAt };
  };

  return [
    ...(ids.licence === null ? [] : [signed('driving_licence', ids.licence)]),
    ...(ids.idProof === null ? [] : [signed('id_proof', ids.idProof)]),
    ...ids.businessPhotos.map(
      (id): PartnerDocument => ({
        kind: 'business_photo',
        url: storage.publicImageUrl(id),
        expiresAt: null,
      }),
    ),
  ];
}
