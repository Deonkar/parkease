import { describe, expect, it } from 'vitest';

import {
  MAX_PRICE_PAISE,
  MIN_PRICE_PAISE,
  paiseToRupees,
  rupeesToPaise,
  toMenuRows,
} from '../menu-rows';

const service = (serviceName: string, vehicleType: string, pricePaise: number, isActive = true) =>
  ({ serviceName, vehicleType, pricePaise, durationMinutes: 40, isActive }) as never;

describe('toMenuRows', () => {
  it('folds two database rows into one UI row with two prices', () => {
    const rows = toMenuRows([
      service('premium_wash', 'car', 39900),
      service('premium_wash', 'two_wheeler', 14900),
    ]);

    const premium = rows.find((r) => r.serviceName === 'premium_wash');
    expect(premium?.carPricePaise).toBe(39900);
    expect(premium?.bikePricePaise).toBe(14900);
  });

  it('returns all five catalogue services in catalogue order, even when the server omits some', () => {
    // A partner who has never saved a menu still has to see five editable
    // rows, or there is no way to set a price for the first time.
    const rows = toMenuRows([service('quick_wipe', 'car', 9900)]);

    expect(rows.map((r) => r.serviceName)).toEqual([
      'basic_exterior',
      'premium_wash',
      'interior_only',
      'full_detailing',
      'quick_wipe',
    ]);
    expect(rows.find((r) => r.serviceName === 'basic_exterior')?.carPricePaise).toBeNull();
  });

  it('carries is_active through, because toggling it off must not delete a price', () => {
    const rows = toMenuRows([service('interior_only', 'car', 29900, false)]);
    expect(rows.find((r) => r.serviceName === 'interior_only')?.isActive).toBe(false);
  });
});

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise('449')).toBe(44900);
  });

  it('converts paise precisely, without a float', () => {
    // 10.03 * 100 in floating point is 1002.9999999999999. An off-by-one
    // paise on every price is a ledger that never balances.
    expect(rupeesToPaise('319.20')).toBe(31920);
    expect(rupeesToPaise('10.03')).toBe(1003);
  });

  it('refuses anything outside the contract bounds', () => {
    expect(rupeesToPaise('9')).toBeNull();
    expect(rupeesToPaise('10')).toBe(MIN_PRICE_PAISE);
    expect(rupeesToPaise('9999')).toBe(MAX_PRICE_PAISE);
    expect(rupeesToPaise('10000')).toBeNull();
  });

  it('refuses junk rather than coercing it to a number', () => {
    for (const input of ['', 'abc', '-50', '1.234', '1e3']) {
      expect(rupeesToPaise(input)).toBeNull();
    }
  });
});

describe('paiseToRupees', () => {
  it('round-trips through rupeesToPaise', () => {
    for (const paise of [1000, 31920, 44900, 999900]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });
});
