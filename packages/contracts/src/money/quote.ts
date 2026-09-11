import { addPaise, mulRate, subPaise, toRate, type Paise, type Rate } from '../primitives/paise.js';

import {
  GST_RATE,
  PLATFORM_COMMISSION_RATE,
  SURGE_MULTIPLIER_MAX,
  SURGE_MULTIPLIER_MIN,
} from './rates.js';

export interface FeeInput {
  readonly basePaise: Paise;
  readonly surgeMultiplier: Rate;
  readonly commissionRate?: Rate;
}

export interface FeeBreakdown {
  readonly basePaise: Paise;
  readonly surgePremiumPaise: Paise;
  readonly commissionPaise: Paise;
  readonly parkeaseFeePaise: Paise;
}

export function parkEaseFee(input: FeeInput): FeeBreakdown {
  const { basePaise, surgeMultiplier } = input;
  const commissionRate = input.commissionRate ?? PLATFORM_COMMISSION_RATE;

  if (surgeMultiplier < SURGE_MULTIPLIER_MIN || surgeMultiplier > SURGE_MULTIPLIER_MAX) {
    throw new RangeError(
      `Surge multiplier ${String(surgeMultiplier)} is outside the permitted range`,
    );
  }

  const surgePremiumPaise = mulRate(basePaise, toRate(surgeMultiplier - SURGE_MULTIPLIER_MIN));
  const commissionPaise = mulRate(basePaise, commissionRate);

  return {
    basePaise,
    surgePremiumPaise,
    commissionPaise,
    parkeaseFeePaise: addPaise(commissionPaise, surgePremiumPaise),
  };
}

export interface Quote extends FeeBreakdown {
  readonly gstPaise: Paise;
  readonly driverTotalPaise: Paise;
  readonly ownerEarningsPaise: Paise;
  readonly surgeMultiplierBp: number;
  readonly commissionRateBp: number;
  readonly gstRateBp: number;
}

export function quote(input: FeeInput & { readonly gstRate?: Rate }): Quote {
  const fee = parkEaseFee(input);
  const gstRate = input.gstRate ?? GST_RATE;
  const commissionRate = input.commissionRate ?? PLATFORM_COMMISSION_RATE;

  const gstPaise = mulRate(fee.parkeaseFeePaise, gstRate);

  const ownerEarningsPaise = subPaise(fee.basePaise, fee.commissionPaise);
  const driverTotalPaise = addPaise(fee.basePaise, fee.surgePremiumPaise, gstPaise);

  const result: Quote = {
    ...fee,
    gstPaise,
    driverTotalPaise,
    ownerEarningsPaise,
    surgeMultiplierBp: Math.round(input.surgeMultiplier * 10_000),
    commissionRateBp: Math.round(commissionRate * 10_000),
    gstRateBp: Math.round(gstRate * 10_000),
  };

  assertQuoteBalances(result);
  return result;
}

export function assertQuoteBalances(q: Quote): void {
  const distributed = q.ownerEarningsPaise + q.parkeaseFeePaise + q.gstPaise;
  if (distributed !== q.driverTotalPaise) {
    throw new Error(
      `Quote does not balance: owner ${String(q.ownerEarningsPaise)} + fee ${String(q.parkeaseFeePaise)} + ` +
        `gst ${String(q.gstPaise)} = ${String(distributed)}, driver total ${String(q.driverTotalPaise)}`,
    );
  }
}
