import type { SpaceSearchItem } from '@parkease/contracts/driver';
import type { Amenity, DurationType } from '@parkease/contracts/enums';

// From the copy module, not the component: this file is deliberately free of
// React, and reaching into a .tsx would drag `react-native` into every
// node-environment suite that imports it (learnings.md).
import { surgeSpokenLabel } from '@/features/shared/surge-copy';
import { formatPaise } from '@/lib/money';

/**
 * How a search result is presented: the strings and the one styling signal the
 * marker, list row and preview card all share. Kept free of React so the copy
 * and the accessibility wording can be tested directly.
 */

/** Car-capable, two-wheeler-only, or shut. Never the only signal — see markerPriceLabel. */
export type MarkerTone = 'car' | 'twoWheeler' | 'closed';

interface DurationWords {
  readonly short: string;
  readonly spoken: string;
}

const DURATION_WORDS: Record<DurationType, DurationWords> = {
  hourly: { short: '/hr', spoken: 'per hour' },
  daily: { short: '/day', spoken: 'per day' },
  weekly: { short: '/week', spoken: 'per week' },
  monthly: { short: '/month', spoken: 'per month' },
};

export function durationSuffix(duration: DurationType): DurationWords {
  return DURATION_WORDS[duration];
}

export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${String(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

/** Screen readers say "metres", not "m". */
function spokenDistance(distanceM: number): string {
  if (distanceM < 1000) return `${String(distanceM)} metres`;
  return `${(distanceM / 1000).toFixed(1)} kilometres`;
}

/** A never-reviewed space reads "New" — never a zero score (prd.md §6.3). */
export function formatRatingLabel(rating: number | null, reviewCount: number): string {
  if (rating === null) return 'New';
  return `${rating.toFixed(1)} (${String(reviewCount)})`;
}

/** Wording from the filter sheet in the task wireframe. */
export const AMENITY_LABELS: Record<Amenity, string> = {
  covered: 'Covered',
  cctv: 'CCTV',
  guarded: 'Guarded',
  ev_charging: 'EV charging',
  lit: 'Lit',
  wheelchair_accessible: 'Wheelchair access',
};

/**
 * MaterialCommunityIcons names — never emoji as UI illustrations.
 * `as const` keeps the literal types, so they satisfy the icon library's name
 * union at the call site without a cast (and without importing it here, which
 * would drag a native module into these unit tests).
 */
export const AMENITY_ICONS = {
  covered: 'home-roof',
  cctv: 'cctv',
  guarded: 'shield-account',
  ev_charging: 'ev-station',
  lit: 'lightbulb-on-outline',
  wheelchair_accessible: 'wheelchair-accessibility',
} as const satisfies Record<Amenity, string>;

export function markerTone(item: SpaceSearchItem): MarkerTone {
  if (!item.isOpenNow) return 'closed';
  return item.availableSlots.car > 0 ? 'car' : 'twoWheeler';
}

/**
 * Every marker carries its price, so the tone colour is never the only thing
 * distinguishing one marker from another (R-FE-12).
 */
export function markerPriceLabel(item: SpaceSearchItem): string {
  return formatPaise(item.effectivePricePaise);
}

function slotPhrase(count: number, noun: string): string {
  return `${String(count)} ${noun} slot${count === 1 ? '' : 's'} free`;
}

export function spaceAccessibilityLabel(item: SpaceSearchItem, duration: DurationType): string {
  const parts = [
    item.title,
    spokenDistance(item.distanceM),
    `${formatPaise(item.effectivePricePaise)} ${durationSuffix(duration).spoken}`,
    slotPhrase(item.availableSlots.car, 'car'),
    slotPhrase(item.availableSlots.twoWheeler, 'two-wheeler'),
  ];
  // Surge belongs in *this* label, not only on the badge.
  //
  // The list row wraps the whole card in a Pressable carrying an explicit
  // accessibilityLabel, which collapses the subtree into one accessible node —
  // so `SurgeBadge`'s own spoken label is unreachable to TalkBack here, even
  // though it works on `SpacePreviewCard`, which scopes its grouping to the
  // header instead. Without this line a screen-reader user is read a surged
  // price and never told it is surged, which is the one thing about a surged
  // price that matters.
  if (item.surgeBadge !== null) {
    parts.push(surgeSpokenLabel(item.surgeBadge, item.surgeMultiplier));
  }
  if (!item.isOpenNow) parts.push('closed now');
  return parts.join(', ');
}
