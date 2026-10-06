import type { PartnerDocument } from '@parkease/contracts/admin';

import type { PartnerDocumentIds } from '../../../domains/identity/partner.queries.js';
import { logger } from '../../../platform/observability/logger.js';
import {
  type CloudinaryService,
  DOCUMENT_URL_TTL_SECONDS,
  InvalidUploadIdError,
} from '../../../platform/storage/cloudinary.service.js';

/**
 * The links an admin reviews a partner by.
 *
 * An ID document or licence is `authenticated`, so its link is signed for five minutes and the
 * response says exactly when it dies. A business photo is the public image drivers see, so its link
 * is the ordinary delivery URL and has no expiry. Each call mints fresh links: nothing here is
 * stored, so a link from yesterday's screen is already dead and never reissued.
 *
 * A stored id that is not shaped like an upload we minted (a dev fixture, a row written before the
 * contracts tightened, or something worse) is left out and logged at warn, which carries the trace
 * id (R-FAIL-01). It never becomes a link and never fails the screen: the admin sees one document
 * fewer, and the log says which partner and which slot. An id that is well formed but points at
 * nothing still produces a link, and answers 404 at Cloudinary, which is where that fact belongs.
 */
export function partnerDocumentsOf(
  storage: CloudinaryService,
  ids: PartnerDocumentIds,
  subject: { readonly userId: string; readonly kind: string },
  now: Date = new Date(),
): PartnerDocument[] {
  const skipping = <T>(slot: PartnerDocument['kind'], make: () => T): T | undefined => {
    try {
      return make();
    } catch (error) {
      if (!(error instanceof InvalidUploadIdError)) throw error;
      logger.warn(
        { userId: subject.userId, partnerKind: subject.kind, slot },
        'stored document id is not an upload id; left out of the partner review',
      );
      return undefined;
    }
  };

  const signed = (slot: 'driving_licence' | 'id_proof', id: string): PartnerDocument | undefined =>
    skipping(slot, () => {
      const { url, expiresAt } = storage.privateDownloadUrl(id, {
        expiresInSeconds: DOCUMENT_URL_TTL_SECONDS,
        now,
      });
      return { kind: slot, url, expiresAt };
    });

  const photo = (id: string): PartnerDocument | undefined =>
    skipping('business_photo', () => ({
      kind: 'business_photo',
      url: storage.publicImageUrl(id),
      expiresAt: null,
    }));

  return [
    ids.licence === null ? undefined : signed('driving_licence', ids.licence),
    ids.idProof === null ? undefined : signed('id_proof', ids.idProof),
    ...ids.businessPhotos.map(photo),
  ].filter((document): document is PartnerDocument => document !== undefined);
}
