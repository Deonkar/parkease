import { mulRate, type Paise, type Rate } from '../primitives/paise.js';

import { GST_RATE, VALET_BASE_FEE_PAISE, VALET_PER_KM_PAISE } from './rates.js';

const METRES_PER_KM = 1000;

export interface ValetLegFee {
  readonly distanceM: number;
  readonly chargeableKm: number;
  readonly basePaise: Paise;
  readonly distancePaise: Paise;
  /** What the leg costs before tax. */
  readonly feePaise: Paise;
  /** The platform's cut, at the rate frozen on the job row. */
  readonly commissionPaise: Paise;
  readonly valetEarningsPaise: Paise;
  /** 18% on the commission only, not on the fee (ADR-009, ADR-021). */
  readonly gstPaise: Paise;
  readonly driverTotalPaise: Paise;
}

/**
 * prd.md §7.1: ₹50 base + ₹10/km.
 *
 * Part-kilometres round *up*, so the amount is a function of a whole number and
 * no floating-point distance can produce a fractional paisa. `distanceM` comes
 * from `ST_Distance` on the geography type, in metres on the spheroid — it is
 * never derived in JS from destructured coordinates, which is the v1 bug this
 * task exists to not repeat (ADR-004, R-DB-07).
 *
 * This lives in `contracts` rather than in `apps/api/src/domains/valet/` because
 * the worker's no-show handler prices a leg too. When two deployables must agree
 * on a number, contracts owns it and both import — a drift between them is not
 * an error anywhere, it is just a wrong charge (learnings.md).
 */
export function computeValetLegFee(distanceM: number, commissionRate: Rate): ValetLegFee {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError(
      `A valet leg cannot span ${String(distanceM)} metres; distance must be finite and non-negative`,
    );
  }

  const chargeableKm = Math.ceil(distanceM / METRES_PER_KM);
  const distancePaise = (chargeableKm * VALET_PER_KM_PAISE) as Paise;
  const feePaise = (VALET_BASE_FEE_PAISE + distancePaise) as Paise;

  const commissionPaise = mulRate(feePaise, commissionRate);
  const gstPaise = mulRate(commissionPaise, GST_RATE);

  return {
    distanceM,
    chargeableKm,
    basePaise: VALET_BASE_FEE_PAISE,
    distancePaise,
    feePaise,
    commissionPaise,
    valetEarningsPaise: (feePaise - commissionPaise) as Paise,
    gstPaise,
    driverTotalPaise: (feePaise + gstPaise) as Paise,
  };
}

/**
 * §11.8. The valet arrived and the driver did not, so the call-out is owed and
 * the distance is not. Expressed as a zero-distance leg rather than as its own
 * arithmetic, which is what keeps the two in step: the no-show charge is the
 * base fee by construction, not by a second constant that could drift from it.
 */
export function computeValetNoShowFee(commissionRate: Rate): ValetLegFee {
  return computeValetLegFee(0, commissionRate);
}
