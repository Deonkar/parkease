import {
  SURGE_BADGE_INTENSITY,
  SURGE_BADGE_LABELS,
  SURGE_METER_SEGMENTS,
  type SurgeBadge as SurgeBadgeTier,
} from '@parkease/contracts/enums';
import { colors } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { SurgeBadge } from '../components/SurgeBadge';

import { byTestId, nodes, render, style, text, type RenderedNode } from './render-native';

// react-native ships Flow source the node-environment parser cannot read, so
// the primitives become host strings. learnings.md records this fix.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('react-native-reanimated', () => ({
  default: { View: 'View' },
  FadeIn: { duration: () => ({}) },
  useReducedMotion: () => true,
}));

const TIERS: readonly SurgeBadgeTier[] = ['moderate_demand', 'high_demand', 'very_high_demand'];

const badgeFor = (badge: SurgeBadgeTier, multiplier = 1.5): RenderedNode | null =>
  render(<SurgeBadge badge={badge} multiplier={multiplier} />);

/** The meter's segments, as drawn. The first node is the meter itself. */
const segments = (tree: RenderedNode | null): RenderedNode[] =>
  nodes(byTestId(tree, 'surge-meter') ?? null).slice(1);

/** How many segments are actually filled in, read off their own background. */
const filledSegments = (tree: RenderedNode | null): number =>
  segments(tree).filter((segment) => style(segment)['backgroundColor'] !== 'transparent').length;

describe('SurgeBadge', () => {
  it('renders nothing at all when the zone is not surging', () => {
    expect(render(<SurgeBadge badge={null} multiplier={1} />)).toBeNull();
  });

  it.each(TIERS)('names the tier and leads with the multiplier for %s', (badge) => {
    expect(text(badgeFor(badge))).toBe(`1.5x ${SURGE_BADGE_LABELS[badge]}`);
  });

  it.each(TIERS)('fills one meter segment per intensity step for %s', (badge) => {
    const tree = badgeFor(badge);

    expect(segments(tree)).toHaveLength(SURGE_METER_SEGMENTS);
    expect(filledSegments(tree)).toBe(SURGE_BADGE_INTENSITY[badge]);
  });

  it('distinguishes every tier from every other without reading the label', () => {
    const counts = TIERS.map((badge) => filledSegments(badgeFor(badge)));

    expect(new Set(counts).size).toBe(TIERS.length);
  });

  it('inverts to a solid fill only at the top tier', () => {
    const grounds = TIERS.map((badge) => {
      const tree = badgeFor(badge);
      return tree === null ? null : style(tree)['backgroundColor'];
    });

    expect(grounds).toEqual([colors.surgeSoft, colors.surgeSoft, colors.surge]);
  });

  it('states a 1.25x multiplier exactly, never rounded up to 1.3x', () => {
    // The ladder is admin-editable, so 1.25 is an ordinary value, not an edge
    // case — and rounding it up overstates a price the server issued (R-FE-06).
    expect(text(badgeFor('moderate_demand', 1.25))).toBe('1.25x moderate demand');
    expect(badgeFor('moderate_demand', 1.25)?.props['accessibilityLabel']).toBe(
      'Moderate demand, prices are 1.25 times the usual rate',
    );
  });

  it('keeps one decimal on a whole or single-decimal multiplier', () => {
    expect(text(badgeFor('high_demand', 1.5))).toBe('1.5x high demand');
    expect(text(badgeFor('very_high_demand', 2))).toBe('2.0x very high demand');
  });

  it('spells the tier and the magnitude out for a screen reader', () => {
    expect(badgeFor('high_demand')?.props['accessibilityLabel']).toBe(
      'High demand, prices are 1.5 times the usual rate',
    );
  });

  it('keeps the label on one line inside a list row', () => {
    const label = nodes(badgeFor('very_high_demand', 2)).find((node) => node.type === 'Text');

    expect(label?.props['numberOfLines']).toBe(1);
  });

  it('is a status indicator, never a control', () => {
    expect(nodes(badgeFor('high_demand')).some((node) => 'onPress' in node.props)).toBe(false);
  });
});
