import { describe, expect, it } from 'vitest';

import { CARWASH_COMMISSION_RATE, computeWashFee, GST_RATE } from '../src/money/index.js';
import { toPaise } from '../src/primitives/paise.js';

const rate = CARWASH_COMMISSION_RATE;

describe('computeWashFee', () => {
  it.each([
    // price, commission, washerEarnings, gst, driverTotal
    [39900, 7980, 31920, 1436, 41336], // Premium Wash, car — §13.7
    [4900, 980, 3920, 176, 5076], // Quick Wipe, bike — §13.7
    [19900, 3980, 15920, 716, 20616], // Basic Exterior, car
    [9900, 1980, 7920, 356, 10256], // Quick Wipe, car
    [79900, 15980, 63920, 2876, 82776], // Full Detailing, car
  ])(
    'a %d paise service costs the driver %d paise once the platform takes its cut',
    (pricePaise, commissionPaise, washerPaise, gstPaise, driverPaise) => {
      const fee = computeWashFee(toPaise(pricePaise), rate);

      expect(fee.pricePaise).toBe(pricePaise);
      expect(fee.commissionPaise).toBe(commissionPaise);
      expect(fee.washerEarningsPaise).toBe(washerPaise);
      expect(fee.gstPaise).toBe(gstPaise);
      expect(fee.driverTotalPaise).toBe(driverPaise);
    },
  );

  /**
   * ADR-009 and ADR-021: GST is charged on the ParkEase Fee, never on the
   * service price. Getting this backwards would over-collect tax on every wash
   * by a factor of five and balance perfectly while doing it.
   */
  it('taxes the commission and not the price', () => {
    const fee = computeWashFee(toPaise(39900), rate);
    expect(fee.gstPaise).toBe(Math.round(fee.commissionPaise * GST_RATE));
    expect(fee.gstPaise).not.toBe(Math.round(fee.pricePaise * GST_RATE));
  });

  it('pays the partner the price less the commission, and nothing else', () => {
    const fee = computeWashFee(toPaise(39900), rate);
    expect(fee.washerEarningsPaise).toBe(fee.pricePaise - fee.commissionPaise);
  });

  it('balances across ten thousand randomised prices', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const pricePaise = toPaise(1 + Math.floor(Math.random() * 1_000_000));
      const fee = computeWashFee(pricePaise, rate);

      expect(fee.washerEarningsPaise + fee.commissionPaise + fee.gstPaise).toBe(
        fee.driverTotalPaise,
      );
      expect(Number.isInteger(fee.commissionPaise)).toBe(true);
      expect(Number.isInteger(fee.gstPaise)).toBe(true);
    }
  });

  /**
   * A zero price is not a free wash, it is a 500.
   *
   * `leg()` in ledger-entries.ts drops zero-amount entries because the
   * `amount_paise > 0` CHECK rejects them, so a zero-price service composes an
   * empty posting and `assertEntriesBalance` refuses an empty posting outright.
   * Failing here names the price; failing there would say "the posting has no
   * entries" three layers from the cause.
   */
  it('refuses a zero price', () => {
    expect(() => computeWashFee(toPaise(0), rate)).toThrow(RangeError);
  });

  it('refuses a price that is not a finite integer', () => {
    expect(() => computeWashFee(Number.NaN as never, rate)).toThrow(RangeError);
    expect(() => computeWashFee(39900.5 as never, rate)).toThrow(RangeError);
  });
});
