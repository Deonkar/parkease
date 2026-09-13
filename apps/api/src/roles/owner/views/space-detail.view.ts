import type { Amenity } from '@parkease/contracts/enums';
import type { SpaceDetail, SpacePricing, SpaceSchedule } from '@parkease/contracts/owner';

import { countSlots } from '../../../domains/space/slots.js';

interface SpaceRow {
  id: string;
  title: string;
  description: string | null;
  addressLine: string;
  landmark: string | null;
  city: string;
  pincode: string;
  location: { lat: number; lng: number };
  pricing: SpacePricing;
  schedule: SpaceSchedule;
  amenities: Amenity[];
  accessInstructions: string | null;
  approvalStatus: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

interface PhotoRow {
  cloudinaryPublicId: string;
  url: string;
  displayOrder: number;
  isPrimary: boolean;
}

export function toSpaceDetail(
  space: SpaceRow,
  slotRows: readonly { vehicleType: string }[],
  photos: readonly PhotoRow[],
): SpaceDetail {
  const photoViews = photos.map((p) => ({
    publicId: p.cloudinaryPublicId,
    url: p.url,
    displayOrder: p.displayOrder,
    isPrimary: p.isPrimary,
  }));

  const primaryPhoto = photoViews.find((p) => p.isPrimary) ?? photoViews[0] ?? null;

  return {
    id: space.id,
    title: space.title,
    city: space.city,
    approvalStatus: space.approvalStatus as SpaceDetail['approvalStatus'],
    slots: countSlots(slotRows),
    primaryPhoto,
    createdAt: space.createdAt.toISOString(),
    description: space.description,
    addressLine: space.addressLine,
    landmark: space.landmark,
    pincode: space.pincode,
    location: space.location,
    pricing: space.pricing,
    schedule: space.schedule,
    amenities: space.amenities,
    accessInstructions: space.accessInstructions,
    photos: photoViews,
    submittedAt: space.submittedAt?.toISOString() ?? null,
    approvedAt: space.approvedAt?.toISOString() ?? null,
    rejectionReason: space.rejectionReason,
  };
}
