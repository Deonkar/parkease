import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PricingTable } from '@/components/sections/PricingTable';
import { PRICING } from '@/lib/pricing';

const html = renderToStaticMarkup(createElement(PricingTable));
const text = html.replace(/<[^>]+>/g, '|');

/** The cells of one ledger, from its heading to the next. */
function ledger(title: string): string {
  const start = text.indexOf(title);
  const next = text.indexOf('For ', start + title.length);
  return text.slice(start, next === -1 ? undefined : next);
}

describe('pricing (ADR-009)', () => {
  it('has no driver-side platform fee line', () => {
    expect(ledger('For drivers')).not.toMatch(/platform fee|convenience fee|booking fee/i);
  });

  it('shows base, surge and GST on the ParkEase fee for drivers', () => {
    const drivers = ledger('For drivers');
    expect(drivers).toContain('Set by the space owner');
    expect(drivers).toContain('Surge pricing');
    expect(drivers).toContain('18% on the ParkEase fee');
  });

  it('lists owner commission as 15% of base, charged once', () => {
    expect(ledger('For space owners')).toContain('15% of the base booking price, charged once');
  });

  it('offers weekly or monthly payouts with a ₹100 minimum', () => {
    const owners = ledger('For space owners');
    expect(owners).toContain('Weekly (Monday) or monthly (1st)');
    expect(owners).toContain('₹100');
  });

  it('lists valet and car wash commission as 20%', () => {
    expect(ledger('For valet partners')).toContain('20% of valet fee');
    expect(ledger('For car wash partners')).toContain('20% of service price');
  });

  it('matches the task 20 worked examples', () => {
    expect(PRICING.valet.exampleFee).toBe(80);
    expect(PRICING.valet.exampleEarns).toBe(64);
    expect(PRICING.wash.examplePrice).toBe(399);
    expect(PRICING.wash.exampleEarns).toBe(319);
  });

  it('prices the driver example from contracts', () => {
    expect(PRICING.example).toMatchObject({ base: 80, owner: 68, parkease: 12, gst: 2.16 });
    expect(PRICING.example.driverTotal).toBe(82.16);
  });
});
