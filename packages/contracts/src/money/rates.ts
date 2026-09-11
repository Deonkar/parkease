import { toRate, type Rate } from '../primitives/paise.js';

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
