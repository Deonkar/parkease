import type { SpaceSummary } from '@parkease/contracts/owner';

import { countSlots } from '../../../domains/space/slots.js';

export function toSpaceSummary(
  space: {
    id: string;
    title: string;
    city: string;
    approvalStatus: string;
    createdAt: Date;
  },
  slotRows: readonly { vehicleType: string }[],
  primaryPhoto:
    | { cloudinaryPublicId: string; url: string; displayOrder: number; isPrimary: boolean }
    | undefined,
): SpaceSummary {
  return {
    id: space.id,
    title: space.title,
    city: space.city,
    approvalStatus: space.approvalStatus as SpaceSummary['approvalStatus'],
    slots: countSlots(slotRows),
    primaryPhoto: primaryPhoto
      ? {
          publicId: primaryPhoto.cloudinaryPublicId,
          url: primaryPhoto.url,
          displayOrder: primaryPhoto.displayOrder,
          isPrimary: primaryPhoto.isPrimary,
        }
      : null,
    createdAt: space.createdAt.toISOString(),
  };
}
