import { toPaise, toRate, type Rate } from '../primitives/paise.js';

export interface DatedRate {
  readonly rate: Rate;
  readonly effectiveFrom: string;
  readonly note: string;
}

export function rateAt(history: readonly DatedRate[], at: Date = new Date()): Rate {
  const applicable = history
    .filter((entry) => new Date(`${entry.effectiveFrom}T00:00:00+05:30`) <= at)
    .at(-1);
  if (!applicable) {
    throw new RangeError(`No rate in force at ${at.toISOString()}`);
  }
  return applicable.rate;
}

export const PLATFORM_COMMISSION_RATE_HISTORY: readonly DatedRate[] = [
  {
    rate: toRate(0.15),
    effectiveFrom: '2026-01-01',
    note: 'Launch rate. 15% of base, charged once, deducted from the owner payout.',
  },
];

export const GST_RATE_HISTORY: readonly DatedRate[] = [
  {
    rate: toRate(0.18),
    effectiveFrom: '2026-01-01',
    note: '18% on the ParkEase Fee only, not on the booking total.',
  },
];

export const VALET_COMMISSION_RATE_HISTORY: readonly DatedRate[] = [
  { rate: toRate(0.2), effectiveFrom: '2026-01-01', note: '20% of the valet fee.' },
];

export const CARWASH_COMMISSION_RATE_HISTORY: readonly DatedRate[] = [
  { rate: toRate(0.2), effectiveFrom: '2026-01-01', note: '20% of the service price.' },
];

export const TCS_RATE_HISTORY: readonly DatedRate[] = [
  { rate: toRate(0), effectiveFrom: '2026-01-01', note: 'Pending CA review. ADR-021 is open.' },
];

export const TDS_RATE_HISTORY: readonly DatedRate[] = [
  { rate: toRate(0), effectiveFrom: '2026-01-01', note: 'Pending CA review. ADR-021 is open.' },
];

export const PLATFORM_COMMISSION_RATE = rateAt(PLATFORM_COMMISSION_RATE_HISTORY);
export const GST_RATE = rateAt(GST_RATE_HISTORY);
export const VALET_COMMISSION_RATE = rateAt(VALET_COMMISSION_RATE_HISTORY);
export const CARWASH_COMMISSION_RATE = rateAt(CARWASH_COMMISSION_RATE_HISTORY);
export const TCS_RATE = rateAt(TCS_RATE_HISTORY);
export const TDS_RATE = rateAt(TDS_RATE_HISTORY);

export const SURGE_ACCRUES_TO = 'platform';

export const SURGE_MULTIPLIER_MIN = toRate(1);
export const SURGE_MULTIPLIER_MAX = toRate(3);

/**
 * Valet leg pricing, prd.md §7.1: ₹50 base + ₹10/km.
 *
 * Plain constants rather than dated histories, matching the goodwill and
 * processing fees in `refund-policy.ts`. A dated history earns its keep for a
 * *rate*, where a change silently restates every historical computation that
 * re-derives from it; a flat fee is frozen onto the job row at accept time by
 * `valet_jobs.fee_paise`, so history is already immutable without one.
 */
export const VALET_BASE_FEE_PAISE = toPaise(5_000);
export const VALET_PER_KM_PAISE = toPaise(1_000);

/**
 * §11.8. Ten minutes after the valet arrives with no driver, the call-out is
 * charged and the distance component is waived — the distance was travelled for
 * a job that did not happen, and billing per-km for a wasted trip reads as a
 * penalty rather than as the call-out fee it is.
 */
export const VALET_NO_SHOW_FEE_PAISE = VALET_BASE_FEE_PAISE;

/**
 * §11.4, prd.md §6.3. A partner below 3.5★ is offered a job only when the
 * filtered candidate pool is empty, and that fallback is logged.
 *
 * Basis points, not a float, and compared against the stored average rather than
 * the displayed one. Task 17 owns the rating read model and fixes both: a rating
 * is `rating_avg_bp integer` beside `rating_count`, exactly as `spaces` already
 * stores it, and 3.5★ is 35 000 bp. Task 11 §11.4 describes a float `rating_avg`
 * defaulting to the floor; that is superseded here, because task 17 names this
 * task as the consumer of `rating_avg_bp` and its nullable column says something
 * a defaulted float cannot — a partner with `rating_count = 0` is *unrated*, not
 * sitting exactly on the floor, and the assignment query can treat the two
 * differently.
 *
 * An unrated partner is eligible in the *first* pass, not the documented
 * fallback: a new partner cannot be starved of the jobs that would rate them,
 * and their presence is not a supply problem worth warning about.
 */
export const PARTNER_RATING_FLOOR_BP = 35_000;
