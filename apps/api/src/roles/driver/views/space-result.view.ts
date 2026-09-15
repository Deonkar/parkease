import type { SpaceSearchItem } from '@parkease/contracts/driver';
import { mulRate, toPaise, toRate } from '@parkease/contracts/primitives';

import { RATING_BP_PER_STAR } from '../../../domains/space/search-sql.js';
import type { SearchResult } from '../../../domains/space/search.service.js';

export function toSpaceResultView(result: SearchResult): SpaceSearchItem {
  const { candidate } = result;
  const basePricePaise = toPaise(candidate.basePricePaise);

  return {
    id: candidate.id,
    title: candidate.title,
    addressLine: candidate.addressLine,
    location: { lat: candidate.lat, lng: candidate.lng },
    distanceM: candidate.distanceM,
    thumbnail: candidate.thumbnailUrl,
    // null means never reviewed — the client renders "New", never a zero score.
    rating: candidate.ratingAvgBp === null ? null : candidate.ratingAvgBp / RATING_BP_PER_STAR,
    reviewCount: candidate.ratingCount,
    amenities: candidate.amenities,
    availableSlots: result.availableSlots,
    basePricePaise,
    surgeMultiplier: result.surgeMultiplier,
    // Base plus surge, with no GST and no platform fee line — that breakdown
    // appears at Review & Pay (ADR-009). mulRate keeps this integer paise
    // rather than float-multiplying money (R-MON-01).
    effectivePricePaise: mulRate(basePricePaise, toRate(result.surgeMultiplier)),
    isOpenNow: result.isOpenNow,
  };
}
