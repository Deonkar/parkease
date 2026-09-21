import { describe, expect, it } from 'vitest';

import {
  computeValetLegFee,
  computeValetNoShowFee,
  VALET_BASE_FEE_PAISE,
  VALET_COMMISSION_RATE,
  VALET_PER_KM_PAISE,
} from '../src/money/index.js';

const rate = VALET_COMMISSION_RATE;

describe('computeValetLegFee', () => {
  it.each([
    // distanceM, chargeableKm, fee, commission, valetEarnings, gst, driverTotal
    [0, 0, 5000, 1000, 4000, 180, 5180],
    [1, 1, 6000, 1200, 4800, 216, 6216],
    [1000, 1, 6000, 1200, 4800, 216, 6216],
    [1001, 2, 7000, 1400, 5600, 252, 7252],
    [3200, 4, 9000, 1800, 7200, 324, 9324],
    [2400, 3, 8000, 1600, 6400, 288, 8288],
  ])(
    '%d m is %d chargeable km and costs the driver %d paise',
    (distanceM, chargeableKm, feePaise, commissionPaise, valetPaise, gstPaise, driverPaise) => {
      const fee = computeValetLegFee(distanceM, rate);

      expect(fee.chargeableKm).toBe(chargeableKm);
      expect(fee.feePaise).toBe(feePaise);
      expect(fee.commissionPaise).toBe(commissionPaise);
      expect(fee.valetEarningsPaise).toBe(valetPaise);
      expect(fee.gstPaise).toBe(gstPaise);
      expect(fee.driverTotalPaise).toBe(driverPaise);
    },
  );

  it('exactly one kilometre does not round up to two', () => {
    expect(computeValetLegFee(1000, rate).chargeableKm).toBe(1);
    expect(computeValetLegFee(1001, rate).chargeableKm).toBe(2);
  });

  it('is composed of the rate constants, never inlined numbers', () => {
    const fee = computeValetLegFee(0, rate);
    expect(fee.basePaise).toBe(VALET_BASE_FEE_PAISE);
    expect(computeValetLegFee(1000, rate).distancePaise).toBe(VALET_PER_KM_PAISE);
  });

  /**
   * The property that makes the ledger balance by construction rather than by
   * inspection: every posting in §11.6 debits `driverTotalPaise` and credits the
   * other three, so if this identity ever fails the posting cannot balance.
   */
  it('keeps valetEarnings + commission + gst === driverTotal over 10,000 distances', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const distanceM = Math.floor(Math.random() * 50_000);
      const fee = computeValetLegFee(distanceM, rate);
      expect(fee.valetEarningsPaise + fee.commissionPaise + fee.gstPaise).toBe(
        fee.driverTotalPaise,
      );
    }
  });

  it('rejects a negative distance rather than inventing a negative fee', () => {
    expect(() => computeValetLegFee(-1, rate)).toThrow(RangeError);
  });

  it('rejects a non-finite distance', () => {
    expect(() => computeValetLegFee(Number.NaN, rate)).toThrow(RangeError);
    expect(() => computeValetLegFee(Number.POSITIVE_INFINITY, rate)).toThrow(RangeError);
  });
});

describe('computeValetNoShowFee', () => {
  it('charges the call-out base only, with the distance component waived', () => {
    const fee = computeValetNoShowFee(rate);

    expect(fee.chargeableKm).toBe(0);
    expect(fee.distancePaise).toBe(0);
    expect(fee.feePaise).toBe(5000);
    expect(fee.commissionPaise).toBe(1000);
    expect(fee.valetEarningsPaise).toBe(4000);
    expect(fee.gstPaise).toBe(180);
    expect(fee.driverTotalPaise).toBe(5180);
  });

  it('is the same shape a zero-distance leg produces', () => {
    expect(computeValetNoShowFee(rate)).toEqual(computeValetLegFee(0, rate));
  });
});
