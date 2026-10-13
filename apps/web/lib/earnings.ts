export interface EarningsInput {
  readonly hourlyPrice: number;
  readonly hoursPerDay: number;
  readonly slots?: number;
  /** 0.15 normally; 0 while the launch commission waiver applies. */
  readonly commissionRate: number;
}

/** Days in the month the estimate assumes. */
export const DAYS_PER_MONTH = 30;

/**
 * `hourlyPrice × hoursPerDay × 30 × (1 − commission)`, the owner's take at base rate.
 * No surge, no GST (task 20 §20.7). The daily figure is rounded first, as the spec does.
 */
export function estimateMonthlyEarnings(input: EarningsInput): number {
  const dailyGross = input.hourlyPrice * input.hoursPerDay * (input.slots ?? 1);
  const dailyNet = Math.round(dailyGross * (1 - input.commissionRate));
  return dailyNet * DAYS_PER_MONTH;
}
