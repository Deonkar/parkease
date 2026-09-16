import { z } from 'zod';

export const SURGE_BADGE_VALUES = ['moderate_demand', 'high_demand', 'very_high_demand'] as const;

export const surgeBadgeSchema = z.enum(SURGE_BADGE_VALUES);
export type SurgeBadge = z.infer<typeof surgeBadgeSchema>;

export const SurgeBadge = {
  MODERATE_DEMAND: 'moderate_demand',
  HIGH_DEMAND: 'high_demand',
  VERY_HIGH_DEMAND: 'very_high_demand',
} as const satisfies Record<string, SurgeBadge>;

type _MissingFromObject = Exclude<SurgeBadge, (typeof SurgeBadge)[keyof typeof SurgeBadge]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;

/**
 * The one copy source for a tier's words. The badge chip, the space-detail
 * banner and the price-breakdown line all read this, so a tier cannot be
 * called "high demand" in one place and "busy" in another.
 */
export const SURGE_BADGE_LABELS = {
  moderate_demand: 'moderate demand',
  high_demand: 'high demand',
  very_high_demand: 'very high demand',
} as const satisfies Record<SurgeBadge, string>;

/** 1 of 3, 2 of 3, 3 of 3 — the filled-bar count the demand meter draws. */
export const SURGE_BADGE_INTENSITY = {
  moderate_demand: 1,
  high_demand: 2,
  very_high_demand: 3,
} as const satisfies Record<SurgeBadge, 1 | 2 | 3>;

export const SURGE_METER_SEGMENTS = 3;
