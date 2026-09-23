import {
  MAX_SERVICE_DURATION_MINUTES,
  MAX_SERVICE_PRICE_PAISE,
  MIN_SERVICE_DURATION_MINUTES,
  MIN_SERVICE_PRICE_PAISE,
} from '@parkease/contracts/washer';
import { describe, expect, it } from 'vitest';

import { paiseToRupees, parseMinutes, rupeesToPaise, toMenuRows } from '../menu-rows';

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

  it('handles a bike-only service: carPricePaise is null, bikePricePaise is set', () => {
    const rows = toMenuRows([service('premium_wash', 'two_wheeler', 19900)]);

    const premium = rows.find((r) => r.serviceName === 'premium_wash');
    expect(premium?.carPricePaise).toBeNull();
    expect(premium?.bikePricePaise).toBe(19900);
    expect(premium?.durationMinutes).toBe(40);
  });

  it('handles an absent service: all fields are defaults', () => {
    const rows = toMenuRows([]);

    const basic = rows.find((r) => r.serviceName === 'basic_exterior');
    expect(basic?.carPricePaise).toBeNull();
    expect(basic?.bikePricePaise).toBeNull();
    expect(basic?.durationMinutes).toBe(30);
    expect(basic?.isActive).toBe(false);
  });
});

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise('449')).toBe(44900);
  });

  it('converts paise precisely, without a float', () => {
    // 10.03 * 100 in floating point is 1002.9999999999999. An off-by-one
    // paise on every price is a ledger that never balances.
    expect(rupeesToPaise('10.03')).toBe(1003);
    expect(rupeesToPaise('10.5')).toBe(1050);
    expect(rupeesToPaise('319.20')).toBe(31920);
  });

  it('refuses anything outside the contract bounds', () => {
    expect(rupeesToPaise('9')).toBeNull();
    expect(rupeesToPaise('10')).toBe(MIN_SERVICE_PRICE_PAISE);
    expect(rupeesToPaise('9999')).toBe(MAX_SERVICE_PRICE_PAISE);
    expect(rupeesToPaise('10000')).toBeNull();
  });

  it('reads a trailing dot as whole rupees, because that is what the partner typed', () => {
    // T8-M2: "10." on blur used to say "between ₹10 and ₹9,999" to someone
    // who had typed 10.
    expect(rupeesToPaise('10.')).toBe(1000);
    expect(rupeesToPaise('449.')).toBe(44900);
  });

  it('refuses junk rather than coercing it to a number', () => {
    for (const input of ['', 'abc', '-50', '1.234', '1e3', '.', '.5']) {
      expect(rupeesToPaise(input)).toBeNull();
    }
  });
});

describe('paiseToRupees', () => {
  it('round-trips through rupeesToPaise', () => {
    for (const paise of [1000, 1003, 1050, 31920, 44900, 999900]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });
});

describe('parseMinutes', () => {
  it('takes whole minutes inside the contract bounds', () => {
    expect(parseMinutes(String(MIN_SERVICE_DURATION_MINUTES))).toBe(MIN_SERVICE_DURATION_MINUTES);
    expect(parseMinutes(String(MAX_SERVICE_DURATION_MINUTES))).toBe(MAX_SERVICE_DURATION_MINUTES);
    expect(parseMinutes(' 40 ')).toBe(40);
  });

  it('refuses a duration the contract would refuse', () => {
    expect(parseMinutes(String(MIN_SERVICE_DURATION_MINUTES - 1))).toBeNull();
    expect(parseMinutes(String(MAX_SERVICE_DURATION_MINUTES + 1))).toBeNull();
  });

  it('refuses junk rather than coercing it', () => {
    for (const input of ['', 'abc', '-5', '40.5', '1e2']) {
      expect(parseMinutes(input)).toBeNull();
    }
  });
});
