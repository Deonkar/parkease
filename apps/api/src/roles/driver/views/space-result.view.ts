import type { SpaceSearchItem } from '@parkease/contracts/driver';
import { mulRate, toPaise } from '@parkease/contracts/primitives';

import { surgeRateOf } from '../../../domains/pricing/surge-rate.js';
import { RATING_BP_PER_STAR } from '../../../domains/space/search-sql.js';
import type { SearchResult } from '../../../domains/space/search.service.js';

export function toSpaceResultView(result: SearchResult): SpaceSearchItem {
  const { candidate, surge } = result;
  const basePricePaise = toPaise(candidate.basePricePaise);
  const surgeRate = surgeRateOf(surge.multiplierBp);

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
    surgeMultiplier: surgeRate,
    // The tier the server chose, not one derived here from the number. One
    // source for the words, so the chip and the price cannot disagree — and
    // `SurgeBadge` renders nothing for null, so a 1.0x zone gets no empty chip.
    surgeBadge: surge.badge,
    // Base plus surge, with no GST and no platform fee line — that breakdown
    // appears at Review & Pay (ADR-009). mulRate keeps this integer paise
    // rather than float-multiplying money (R-MON-01).
    effectivePricePaise: mulRate(basePricePaise, surgeRate),
    isOpenNow: result.isOpenNow,
  };
}
