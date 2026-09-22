import { mulRate, type Paise, type Rate } from '../primitives/paise.js';

import { GST_RATE } from './rates.js';

export interface WashFee {
  /** What the partner charges for this service and vehicle type, from their menu. */
  readonly pricePaise: Paise;
  /** The platform's cut, at the rate frozen on the job row. */
  readonly commissionPaise: Paise;
  readonly washerEarningsPaise: Paise;
  /** 18% on the commission only, not on the price (ADR-009, ADR-021). */
  readonly gstPaise: Paise;
  readonly driverTotalPaise: Paise;
}

/**
 * §13.7, prd.md §9: the platform takes 20% of the partner's own price.
 *
 * Unlike a valet leg there is no distance and no base — the price comes from
 * the partner's menu row for this `(service_name, vehicle_type)` and is frozen
 * onto `wash_jobs.price_paise` at accept, so a later menu edit cannot restate a
 * settled job (R-MONEY-03). All this function does is split a stored amount at
 * a stored rate, which is why it is arithmetic rather than pricing:
 * `domains/pricing` remains the only module that *produces* an amount
 * (R-ARCH-06).
 *
 * This lives in `contracts` rather than in `apps/api/src/domains/carwash/`
 * because the worker prices a wash too. When two deployables must agree on a
 * number, contracts owns it and both import — a drift between them is not an
 * error anywhere, it is just a wrong charge (learnings.md).
 */
export function computeWashFee(pricePaise: Paise, commissionRate: Rate): WashFee {
  /**
   * A zero or fractional price is refused here rather than three layers down.
   *
   * `leg()` in `ledger-entries.ts` drops zero-amount entries, because the
   * `ledger_entries_amount_check` CHECK is `amount_paise > 0`. So a zero price
   * would compose a posting with no rows at all, and `assertEntriesBalance`
   * rejects an empty posting — a free wash would surface as "the posting has no
   * entries" from inside the ledger, naming nothing useful. `wash_services`
   * carries a matching `price_paise > 0` CHECK; this is the application half of
   * the same guarantee.
   */
  if (!Number.isInteger(pricePaise) || pricePaise <= 0) {
    throw new RangeError(
      `A car wash cannot cost ${String(pricePaise)} paise; the price must be a positive integer`,
    );
  }

  const commissionPaise = mulRate(pricePaise, commissionRate);
  const gstPaise = mulRate(commissionPaise, GST_RATE);

  return {
    pricePaise,
    commissionPaise,
    washerEarningsPaise: (pricePaise - commissionPaise) as Paise,
    gstPaise,
    driverTotalPaise: (pricePaise + gstPaise) as Paise,
  };
}
