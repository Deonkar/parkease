import { quoteBreakdownSchema, type QuoteBreakdown } from '@parkease/contracts/driver';
import { describe, expect, it, vi } from 'vitest';

import { render, text } from '../../shared/__tests__/render-native';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { SurgeBanner } from '../components/SurgeBanner';

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

/**
 * The canonical booking from task-10 §10.8, built through the real schema so a
 * fixture that drifts from the contract fails rather than hiding the drift.
 */
const quote = (overrides: Record<string, unknown> = {}): QuoteBreakdown =>
  quoteBreakdownSchema.parse({
    basePaise: 6000,
    surgePremiumPaise: 3000,
    gstPaise: 702,
    totalPaise: 9702,
    ownerEarningsPaise: 5100,
    surgeMultiplierBp: 15_000,
    surgeBadge: 'high_demand' as const,
    ...overrides,
  });

describe('SurgeBanner', () => {
  it('reads exactly as website.md §2.6', () => {
    expect(text(render(<SurgeBanner badge="high_demand" multiplier={1.5} />))).toBe(
      '1.5x High Demand — prices may be higher than usual',
    );
  });

  it('names the tier it was actually given', () => {
    expect(text(render(<SurgeBanner badge="very_high_demand" multiplier={2} />))).toBe(
      '2.0x Very High Demand — prices may be higher than usual',
    );
  });

  it('renders nothing at all when the zone is not surging', () => {
    expect(render(<SurgeBanner badge={null} multiplier={1} />)).toBeNull();
  });

  it('states a 1.25x multiplier exactly, never rounded up to 1.3x', () => {
    expect(text(render(<SurgeBanner badge="moderate_demand" multiplier={1.25} />))).toBe(
      '1.25x Moderate Demand — prices may be higher than usual',
    );
  });

  it('tells a screen reader what the banner means, not just what it says', () => {
    expect(
      render(<SurgeBanner badge="high_demand" multiplier={1.5} />)?.props['accessibilityLabel'],
    ).toBe('High demand, prices are 1.5 times the usual rate');
  });
});

describe('PriceBreakdown surge line', () => {
  it('names the tier the server sent rather than assuming one', () => {
    expect(text(render(<PriceBreakdown quote={quote()} surgeBadge="moderate_demand" />))).toContain(
      'Surge (1.5x moderate demand)',
    );
  });

  it('states a 1.25x multiplier exactly, never rounded up to 1.3x', () => {
    expect(
      text(
        render(
          <PriceBreakdown
            quote={quote({ surgeMultiplierBp: 12_500 })}
            surgeBadge="moderate_demand"
          />,
        ),
      ),
    ).toContain('Surge (1.25x moderate demand)');
  });

  it('falls back to the bare multiplier when no tier travelled with the quote', () => {
    const rendered = text(render(<PriceBreakdown quote={quote()} surgeBadge={null} />));

    expect(rendered).toContain('Surge (1.5x)');
    expect(rendered).not.toContain('demand');
  });

  it('shows no surge line at all when nothing was charged for surge', () => {
    expect(
      text(
        render(
          <PriceBreakdown
            quote={quote({ surgePremiumPaise: 0, surgeMultiplierBp: 10_000 })}
            surgeBadge={null}
          />,
        ),
      ),
    ).not.toContain('Surge');
  });
});
