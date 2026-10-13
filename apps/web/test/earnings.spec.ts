import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EarningsCalculator } from '@/components/sections/EarningsCalculator';
import { estimateMonthlyEarnings } from '@/lib/earnings';
import { PRICING } from '@/lib/pricing';

describe('estimateMonthlyEarnings', () => {
  it('₹30/hr × 6 hrs/day → ₹4,590 after 15% commission', () => {
    expect(estimateMonthlyEarnings({ hourlyPrice: 30, hoursPerDay: 6, commissionRate: 0.15 })).toBe(
      4590,
    );
  });

  it('₹50/hr × 8 hrs/day → ₹10,200 after 15% commission', () => {
    expect(estimateMonthlyEarnings({ hourlyPrice: 50, hoursPerDay: 8, commissionRate: 0.15 })).toBe(
      10200,
    );
  });

  it('multiplies by the number of slots', () => {
    expect(
      estimateMonthlyEarnings({ hourlyPrice: 30, hoursPerDay: 6, slots: 2, commissionRate: 0.15 }),
    ).toBe(9180);
  });

  it('uses the commission rate from contracts', () => {
    expect(PRICING.commissionRate).toBe(0.15);
  });
});

describe('EarningsCalculator', () => {
  const html = renderToStaticMarkup(
    createElement(EarningsCalculator, {
      commissionRate: PRICING.commissionRate,
      waiverSlots: PRICING.waiverSlots,
      waiverMonths: PRICING.waiverMonths,
      minimumPayout: PRICING.minimumPayout,
    }),
  );

  const text = (markup: string) => markup.replace(/<[^>]+>/g, '');

  it('defaults to ₹4,590 a month', () => {
    expect(text(html)).toContain('₹4,590');
  });

  it('says the estimate is after commission', () => {
    expect(html).toContain('After 15% ParkEase commission.');
  });

  it('announces the estimate with its label, as one update', () => {
    const live = /<p aria-live="polite" aria-atomic="true"[^>]*>(.*?)<\/p>/.exec(html);
    expect(text(live?.[1] ?? '')).toBe('Estimated monthly earnings₹4,590');
  });

  it('gives each slider a spoken value', () => {
    expect(html).toContain('aria-valuetext="₹30 an hour"');
    expect(html).toContain('aria-valuetext="6 hours a day"');
    expect(html).toContain('aria-valuetext="1 slot"');
  });
});
