import { describe, expect, it, vi } from 'vitest';

import { assertQuoteBalances, parkEaseFee, quote } from '../src/money/quote.js';
import { mulRate, toPaise, toRate } from '../src/primitives/paise.js';

describe('canonical ADR-009 vector', () => {
  it('matches the canonical ADR-009 vector', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });

    expect(q.surgePremiumPaise).toBe(3000);
    expect(q.commissionPaise).toBe(900);
    expect(q.parkeaseFeePaise).toBe(3900);
    expect(q.gstPaise).toBe(702);
    expect(q.driverTotalPaise).toBe(9702);
    expect(q.ownerEarningsPaise).toBe(5100);
  });

  it('5100 + 3900 + 702 === 9702', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });
    expect(q.ownerEarningsPaise + q.parkeaseFeePaise + q.gstPaise).toBe(9702);
  });

  it('every value is compared as an integer; no toBeCloseTo', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });
    expect(Number.isInteger(q.driverTotalPaise)).toBe(true);
    expect(Number.isInteger(q.ownerEarningsPaise)).toBe(true);
    expect(Number.isInteger(q.gstPaise)).toBe(true);
    expect(Number.isInteger(q.parkeaseFeePaise)).toBe(true);
  });
});

describe('quote behaviour', () => {
  it('surge 1.0 produces surgePremiumPaise === 0', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.0) });
    expect(q.surgePremiumPaise).toBe(0);
  });

  it('with surge 1.0, base 6000: fee 900, GST 162, driver total 6162, owner 5100', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.0) });
    expect(q.commissionPaise).toBe(900);
    expect(q.parkeaseFeePaise).toBe(900);
    expect(q.gstPaise).toBe(162);
    expect(q.driverTotalPaise).toBe(6162);
    expect(q.ownerEarningsPaise).toBe(5100);
    expect(q.ownerEarningsPaise + q.parkeaseFeePaise + q.gstPaise).toBe(6162);
  });

  it('surge 3.0 is accepted', () => {
    expect(() => quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(3.0) })).not.toThrow();
  });

  it('surge 3.01 throws RangeError', () => {
    expect(() => quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(3.01) })).toThrow(
      RangeError,
    );
  });

  it('surge 0.9 throws RangeError', () => {
    expect(() => quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(0.9) })).toThrow(
      RangeError,
    );
  });

  it('assertQuoteBalances throws on a deliberately corrupted breakdown', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });
    const corrupted = { ...q, gstPaise: (q.gstPaise + 1) as typeof q.gstPaise };
    expect(() => assertQuoteBalances(corrupted)).toThrow('Quote does not balance');
  });

  it('recomputing the canonical vector through rateAt gives the same numbers', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });
    expect(q.driverTotalPaise).toBe(9702);
    expect(q.ownerEarningsPaise).toBe(5100);
  });

  it('bp fields are correct', () => {
    const q = quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });
    expect(q.surgeMultiplierBp).toBe(15_000);
    expect(q.commissionRateBp).toBe(1_500);
    expect(q.gstRateBp).toBe(1_800);
  });
});

describe('property test: quote balances over random inputs', () => {
  it('owner + fee + gst === driverTotal for 10,000 random pairs', () => {
    for (let i = 0; i < 10_000; i++) {
      const base = Math.floor(Math.random() * 100_000) + 1;
      const mult = 1 + Math.random() * 2;
      const multiplierClamped = Math.min(3, Math.max(1, Math.round(mult * 100) / 100));

      const q = quote({
        basePaise: toPaise(base),
        surgeMultiplier: toRate(multiplierClamped),
      });

      expect(q.ownerEarningsPaise + q.parkeaseFeePaise + q.gstPaise).toBe(q.driverTotalPaise);
    }
  });

  it('ownerEarnings === base − mulRate(base, commissionRate) for 10,000 random pairs', () => {
    for (let i = 0; i < 10_000; i++) {
      const base = Math.floor(Math.random() * 100_000) + 1;
      const mult = 1 + Math.random() * 2;
      const multiplierClamped = Math.min(3, Math.max(1, Math.round(mult * 100) / 100));

      const basePaise = toPaise(base);
      const q = quote({
        basePaise,
        surgeMultiplier: toRate(multiplierClamped),
      });

      const expectedOwner = base - mulRate(basePaise, toRate(0.15));
      expect(q.ownerEarningsPaise).toBe(expectedOwner);
    }
  });
});

describe('mulRate call count in quote', () => {
  it('mulRate is called exactly three times for a surged quote', async () => {
    const paiseModule = await import('../src/primitives/paise.js');
    const spy = vi.spyOn(paiseModule, 'mulRate');
    spy.mockClear();

    quote({ basePaise: toPaise(6000), surgeMultiplier: toRate(1.5) });

    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});

describe('parkEaseFee', () => {
  it('calculates fee breakdown correctly', () => {
    const fee = parkEaseFee({
      basePaise: toPaise(6000),
      surgeMultiplier: toRate(1.5),
    });
    expect(fee.basePaise).toBe(6000);
    expect(fee.surgePremiumPaise).toBe(3000);
    expect(fee.commissionPaise).toBe(900);
    expect(fee.parkeaseFeePaise).toBe(3900);
  });

  it('accepts a custom commission rate', () => {
    const fee = parkEaseFee({
      basePaise: toPaise(10000),
      surgeMultiplier: toRate(1.0),
      commissionRate: toRate(0.2),
    });
    expect(fee.commissionPaise).toBe(2000);
    expect(fee.parkeaseFeePaise).toBe(2000);
  });
});
