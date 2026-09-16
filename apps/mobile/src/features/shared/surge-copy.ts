import { SURGE_BADGE_LABELS, type SurgeBadge } from '@parkease/contracts/enums';

/**
 * How a surge tier is written and spoken. **No React, and no `react-native`.**
 *
 * These lived in `components/SurgeBadge.tsx` until `space-display.ts` needed the
 * spoken label for the search row's accessibility string. `space-display.ts`
 * says of itself that it is "kept free of React so the copy" can be tested
 * plainly — and importing them from the component broke that immediately and
 * loudly: any node-environment suite that reaches `react-native` dies with
 * `Expected 'from', got 'typeOf'`, naming the *test* file rather than the
 * import that caused it (learnings.md).
 *
 * The right reading of that failure is not "mock react-native in one more
 * test". It is that a string is not a component concern. Both the chip and the
 * list row's label are consumers of the same copy, so the copy lives on its own.
 */

/**
 * Two decimals with a single trailing zero trimmed: 1.25x, 1.5x, 2.0x.
 *
 * `toFixed(1)` rendered the ladder's own 1.25x tier as "1.3x" — the client
 * overstating a server-issued price, which is R-FE-06 inverted. The ladder is
 * admin-editable (task-10 §10.4), so a two-decimal multiplier is ordinary
 * configuration rather than a hypothetical.
 */
export function formatSurgeMultiplier(multiplier: number): string {
  return multiplier.toFixed(2).replace(/0$/, '');
}

/**
 * "High demand, prices are 1.5 times the usual rate" — the tier *and* the
 * number, because the meter is decorative to a screen reader and a bare tier
 * name would not say how much more this costs.
 */
export function surgeSpokenLabel(badge: SurgeBadge, multiplier: number): string {
  const label = SURGE_BADGE_LABELS[badge];
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}, prices are ${formatSurgeMultiplier(multiplier)} times the usual rate`;
}
