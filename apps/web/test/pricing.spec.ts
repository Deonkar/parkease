import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PricingTable } from '@/components/sections/PricingTable';
import { PRICING } from '@/lib/pricing';
import { formatRupees } from '@/lib/rupee';

const html = renderToStaticMarkup(createElement(PricingTable));
/** The rows under one ledger's <h3>, as "label|value" text, up to the next ledger's heading. */
function ledger(title: string): string {
  const section = html
    .split('<h3')
    .find((part) => part.startsWith(` class="type-card`) && part.includes(`>${title}</h3>`));
  if (section === undefined) throw new Error(`No ledger headed "${title}"`);
  return section.replace(/<[^>]+>/g, '|');
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

  it('valets and wash partners keep the same share, which the partners page quotes once', () => {
    expect(PRICING.valet.keepsPercent).toBe(PRICING.wash.keepsPercent);
  });

  it('lists valet and car wash commission as 20%', () => {
    expect(ledger('For valet partners')).toContain('20% of valet fee');
    expect(ledger('For car wash partners')).toContain('20% of service price');
  });

  it('matches the task 20 worked examples', () => {
    expect(PRICING.valet.exampleFee).toBe(80);
    expect(PRICING.valet.exampleEarns).toBe(64);
    expect(PRICING.wash.examplePrice).toBe(399);
    expect(formatRupees(PRICING.wash.exampleEarns)).toBe('₹319');
  });

  it('prices the driver example from contracts', () => {
    expect(PRICING.example).toMatchObject({ base: 80, owner: 68, parkease: 12, gst: 2.16 });
    expect(PRICING.example.driverTotal).toBe(82.16);
  });
});
