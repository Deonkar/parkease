import { toPaise } from '@parkease/contracts/primitives';
import type { WashJobOffer } from '@parkease/contracts/washer';
import { fontSize } from '@parkease/tokens';
import { describe, expect, it, vi } from 'vitest';

import { byTestId, nodes, render, style, text } from '../../shared/__tests__/render-native';
import { WashOfferCard, type WashOfferCardProps } from '../components/WashOfferCard';

// react-native ships Flow source the node-environment parser cannot read.
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { create: (sheet: unknown) => sheet, hairlineWidth: 1 },
}));

vi.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));

const offer = (overrides: Partial<WashJobOffer> = {}): WashJobOffer => ({
  // Branded ids carry no runtime constructor; a fixture is in-process data.
  jobId: '0192f2a1-0000-7000-8000-000000000001' as WashJobOffer['jobId'],
  bookingId: '0192f2a1-0000-7000-8000-000000000002' as WashJobOffer['bookingId'],
  serviceName: 'premium_wash',
  vehicleType: 'car',
  spaceLocation: { lat: 12.9345, lng: 77.6101 },
  distanceM: 640,
  earningsPaise: toPaise(31920),
  offeredAt: '2026-09-23T10:00:00.000Z',
  expiresAt: '2026-09-23T10:03:00.000Z',
  ...overrides,
});

const card = (props: Partial<WashOfferCardProps> = {}) =>
  render(
    <WashOfferCard
      offer={offer()}
      expiresInLabel="2:31"
      expiresFraction={0.84}
      durationMinutes={40}
      onAccept={() => undefined}
      {...props}
    />,
  );

/**
 * Every figure in this file is deliberately inconsistent with the commission
 * rate: the guard is not "the arithmetic is right here", it is "there is no
 * arithmetic here" (R-FE-06). If the card derived anything from the price, it
 * would disagree with the fixture and fail.
 */
describe('the earnings figure', () => {
  it('renders the server earnings figure unchanged', () => {
    // Deliberately NOT 80% of anything: if the component multiplies, this fails.
    const tree = card({ offer: offer({ earningsPaise: toPaise(12345) }) });

    expect(text(tree)).toContain('₹123.45');
  });

  it('is the headline, above the service name', () => {
    const tree = card();
    const all = text(tree);

    expect(all.indexOf('₹319.20')).toBeLessThan(all.indexOf('Premium Wash'));
    const earnings = byTestId(tree, 'offer-earnings');
    expect(earnings && style(earnings)['fontSize']).toBe(fontSize['3xl']);
  });
});

describe('what the job is', () => {
  it('names the service from the closed catalogue, not the enum', () => {
    const all = text(card({ offer: offer({ serviceName: 'full_detailing' }) }));

    expect(all).toContain('Full Detailing');
    expect(all).not.toContain('full_detailing');
  });

  it('calls a two-wheeler a bike', () => {
    expect(text(card({ offer: offer({ vehicleType: 'two_wheeler' }) }))).toContain('bike');
  });

  it('shows distance and duration as chips', () => {
    const all = text(card({ offer: offer({ distanceM: 1200 }) }));

    expect(all).toContain('1.2 km away');
    expect(all).toContain('40 min');
  });

  it('drops the duration chip rather than guessing one', () => {
    expect(text(card({ durationMinutes: null }))).not.toContain('min');
  });
});

describe('the expiry', () => {
  it('says the time left in words beside the bar, never the bar alone (R-FE-12)', () => {
    const tree = card();

    expect(text(tree)).toContain('Expires in 2:31');
    const fill = byTestId(tree, 'offer-expiry-fill');
    expect(fill && style(fill)['width']).toBe('84%');
  });

  it('never draws the bar outside its track', () => {
    const over = byTestId(card({ expiresFraction: 1.7 }), 'offer-expiry-fill');
    const under = byTestId(card({ expiresFraction: -0.3 }), 'offer-expiry-fill');

    expect(over && style(over)['width']).toBe('100%');
    expect(under && style(under)['width']).toBe('0%');
  });
});

describe('accepting', () => {
  it('gives the accept button a 44dp minimum target', () => {
    const accept = byTestId(card(), 'offer-accept');
    const minHeight = accept ? Number(style(accept)['minHeight']) : 0;

    expect(minHeight).toBeGreaterThanOrEqual(44);
  });

  it('calls onAccept when pressed', () => {
    const onAccept = vi.fn();
    const accept = byTestId(card({ onAccept }), 'offer-accept');

    (accept?.props['onPress'] as () => void)();

    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('states the lock in TEXT, never by colour alone (R-FE-12)', () => {
    const tree = card({ lockedReason: 'Verify your documents to accept jobs' });

    expect(text(tree)).toContain('Verify your documents to accept jobs');
  });

  it('tells assistive tech the locked button is disabled', () => {
    const accept = byTestId(card({ lockedReason: 'Verify your documents' }), 'offer-accept');

    expect(accept?.props['accessibilityState']).toEqual({ disabled: true, busy: false });
    expect(accept?.props['disabled']).toBe(true);
  });

  it('keeps the earnings visible while locked — the reason to finish verifying', () => {
    expect(text(card({ lockedReason: 'Verify your documents' }))).toContain('₹319.20');
  });

  it('cannot be pressed twice while an accept is in flight', () => {
    const accept = byTestId(card({ accepting: true }), 'offer-accept');

    expect(accept?.props['disabled']).toBe(true);
    expect(accept?.props['accessibilityState']).toEqual({ disabled: true, busy: true });
  });

  it('is a real button to a screen reader, labelled with the money', () => {
    const buttons = nodes(card()).filter((n) => n.props['accessibilityRole'] === 'button');

    expect(buttons).toHaveLength(1);
    expect(String(buttons[0]?.props['accessibilityLabel'])).toContain('₹319.20');
  });
});
