import { toPaise } from '@parkease/contracts/primitives';
import type { WashJobOffer } from '@parkease/contracts/washer';
import { fontSize } from '@parkease/tokens';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { byTestId, mount, nodes, render, style, text } from '../../shared/__tests__/render-native';
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

// Counts the card's own renders: it formats the distance once per render.
const formatCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/format', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/format')>();
  return {
    ...real,
    formatDistance: (metres: number) => {
      formatCalls.count += 1;
      return real.formatDistance(metres);
    },
  };
});

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

/** 29 seconds into the three-minute window: 2:31 left, 84% of the bar. */
const NOW = Date.parse('2026-09-23T10:00:29.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  formatCalls.count = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const cardElement = (props: Partial<WashOfferCardProps> = {}) => (
  <WashOfferCard offer={offer()} durationMinutes={40} onAccept={() => undefined} {...props} />
);

const card = (props: Partial<WashOfferCardProps> = {}) => render(cardElement(props));

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
    vi.setSystemTime(Date.parse('2026-09-23T09:59:00.000Z'));
    const over = byTestId(card(), 'offer-expiry-fill');
    vi.setSystemTime(Date.parse('2026-09-23T10:05:00.000Z'));
    const under = byTestId(card(), 'offer-expiry-fill');

    expect(over && style(over)['width']).toBe('100%');
    expect(under && style(under)['width']).toBe('0%');
  });
});

/**
 * H5: the countdown owns its one-second timer. The card around it — and the
 * screen around that — no longer re-render every second.
 */
describe('the countdown', () => {
  it('ticks by itself, once a second', () => {
    const view = mount(cardElement());

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(text(view.tree())).toContain('Expires in 2:30');
  });

  it('does not re-render the card when it ticks', () => {
    mount(cardElement());
    const rendersBefore = formatCalls.count;

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(formatCalls.count).toBe(rendersBefore);
  });

  it('locks Accept, in words, once the offer has expired', () => {
    const view = mount(cardElement());

    act(() => {
      vi.advanceTimersByTime(152_000);
    });

    expect(text(view.tree())).toContain('This offer has expired');
    expect(byTestId(view.tree(), 'offer-accept')?.props['disabled']).toBe(true);
  });

  /**
   * N1: FlashList recycles a card component across different offers. A card
   * that expired and is reused for a fresh offer must not carry the lock over.
   */
  it('does not carry an expired lock to the next offer when the card is recycled', () => {
    const view = mount(cardElement());
    act(() => {
      vi.advanceTimersByTime(152_000);
    });
    expect(text(view.tree())).toContain('This offer has expired');

    const now = Date.now();
    const fresh = offer({
      jobId: '0192f2a1-0000-7000-8000-000000000009' as WashJobOffer['jobId'],
      offeredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 180_000).toISOString(),
    });
    view.update(cardElement({ offer: fresh }));

    expect(text(view.tree())).not.toContain('This offer has expired');
    expect(text(view.tree())).toContain('Expires in 3:00');
    expect(byTestId(view.tree(), 'offer-accept')?.props['disabled']).toBe(false);
  });

  it('still expires the recycled card when ITS offer runs out', () => {
    const view = mount(cardElement());
    act(() => {
      vi.advanceTimersByTime(152_000);
    });
    const now = Date.now();
    view.update(
      cardElement({
        offer: offer({
          jobId: '0192f2a1-0000-7000-8000-000000000009' as WashJobOffer['jobId'],
          offeredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        }),
      }),
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(text(view.tree())).toContain('This offer has expired');
    expect(byTestId(view.tree(), 'offer-accept')?.props['disabled']).toBe(true);
  });

  it('is a memoised card, so an unchanged offer is not re-rendered by its list', () => {
    expect((WashOfferCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });
});

describe('accepting', () => {
  it('gives the accept button a 44dp minimum target', () => {
    const accept = byTestId(card(), 'offer-accept');
    const minHeight = accept ? Number(style(accept)['minHeight']) : 0;

    expect(minHeight).toBeGreaterThanOrEqual(44);
  });

  it('calls onAccept with its own job id, so the screen can pass one stable callback (H5)', () => {
    const onAccept = vi.fn();
    const accept = byTestId(card({ onAccept }), 'offer-accept');

    (accept?.props['onPress'] as () => void)();

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith('0192f2a1-0000-7000-8000-000000000001');
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
