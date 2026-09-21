import { toPaise } from '@parkease/contracts/primitives';
import type { ValetEarningsSummary, ValetOffer } from '@parkease/contracts/valet';
import { describe, expect, it, vi } from 'vitest';

import { render, text } from '../../shared/__tests__/render-native';
import { EarningsSummary } from '../components/EarningsSummary';
import { OfferFocusCard } from '../components/OfferFocusCard';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

const offer = (overrides: Partial<ValetOffer> = {}): ValetOffer => ({
  // Branded ids carry no runtime constructor; a fixture is in-process data.
  jobId: '0192f2a1-0000-7000-8000-000000000001' as ValetOffer['jobId'],
  bookingId: '0192f2a1-0000-7000-8000-000000000002' as ValetOffer['bookingId'],
  pickupAddress: 'Forum Mall, Koramangala',
  pickupLocation: { lat: 12.9345, lng: 77.6101 },
  distanceM: 380,
  earningsPaise: toPaise(7200),
  offeredAt: '2026-09-21T10:02:00.000Z',
  expiresAt: '2026-09-21T10:04:00.000Z',
  ...overrides,
});

/**
 * The point of these tests, and the reason they use impossible numbers.
 *
 * ParkEase v1 summed `feePaise` client-side and showed the gross as take-home —
 * 25% more than the valet is actually paid. The guard against that is not "the
 * arithmetic is correct here", it is "there is no arithmetic here". So every
 * figure below is deliberately inconsistent with the commission rate: if the
 * component recomputes anything, it disagrees with the fixture and fails.
 */
describe('offer earnings are the server figure, never a derivation', () => {
  it('renders the earnings the server sent', () => {
    const tree = render(
      <OfferFocusCard
        offer={offer()}
        position={1}
        total={3}
        onAccept={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(text(tree)).toContain('₹72.00');
  });

  it('renders a figure that is not 80% of any plausible fee, unchanged', () => {
    // If anything client-side applied a 20% commission, this would render ₹72.
    const tree = render(
      <OfferFocusCard
        offer={offer({ earningsPaise: toPaise(9000) })}
        position={1}
        total={3}
        onAccept={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(text(tree)).toContain('₹90.00');
    expect(text(tree)).not.toContain('₹72.00');
  });

  it('shows the position in the set so a skipped offer is known to be one of several', () => {
    const tree = render(
      <OfferFocusCard
        offer={offer()}
        position={2}
        total={3}
        onAccept={() => {}}
        onSkip={() => {}}
      />,
    );

    expect(text(tree)).toContain('2 of 3');
  });
});

describe('earnings summary is a display of the ledger', () => {
  const summary = (overrides: Partial<ValetEarningsSummary> = {}): ValetEarningsSummary => ({
    grossPaise: toPaise(273000),
    reversedPaise: toPaise(0),
    netPaise: toPaise(218400),
    jobsCompleted: 14,
    ...overrides,
  });

  it('renders the ledger net as sent', () => {
    const tree = render(<EarningsSummary summary={summary()} />);

    expect(text(tree)).toContain('₹2,184.00');
  });

  it('renders a net that does not equal gross minus reversed, unchanged', () => {
    // Deliberately not self-consistent. The screen reports the ledger, it does
    // not audit it — a component that "corrected" this would be inventing money.
    const tree = render(
      <EarningsSummary
        summary={summary({
          grossPaise: toPaise(100000),
          reversedPaise: toPaise(0),
          netPaise: toPaise(73333),
        })}
      />,
    );

    expect(text(tree)).toContain('₹733.33');
  });

  it('surfaces a reversal rather than hiding it inside the net', () => {
    const tree = render(
      <EarningsSummary
        summary={summary({
          grossPaise: toPaise(273000),
          reversedPaise: toPaise(5000),
          netPaise: toPaise(213400),
        })}
      />,
    );

    // An unexplained smaller number is a support ticket; a named clawback is not.
    expect(text(tree)).toContain('₹50.00');
    expect(text(tree)).toContain('₹2,134.00');
  });

  it('counts jobs from the server field', () => {
    const tree = render(<EarningsSummary summary={summary({ jobsCompleted: 14 })} />);

    expect(text(tree)).toContain('14');
  });
});
