import {
  ACTIVE_GRACE_MINUTES,
  ACTIVE_GRACE_REFUND_RATE,
  CARWASH_COMMISSION_RATE,
  COMMISSION_WAIVER_MONTHS,
  COMMISSION_WAIVER_SLOTS,
  GST_RATE,
  MINIMUM_PAYOUT_PAISE,
  OWNER_CANCEL_GOODWILL_PAISE,
  PLATFORM_COMMISSION_RATE,
  quote,
  REFUND_PROCESSING_FEE_PAISE,
  SURGE_MULTIPLIER_MAX,
  VALET_BASE_FEE_PAISE,
  VALET_COMMISSION_RATE,
  VALET_PER_KM_PAISE,
} from '@parkease/contracts/money';
import { toPaise, toRate } from '@parkease/contracts/primitives';

/**
 * Every number the site quotes, derived from @parkease/contracts so the marketing copy cannot
 * drift from what the API charges. Nothing here is typed in by hand.
 */

const pct = (rate: number): number => Math.round(rate * 100);
const rupees = (paise: number): number => paise / 100;

export function formatRupees(amount: number, decimals: 0 | 2 = 0): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Two hours at ₹40, at a normal hour: the worked example used on the site. */
const example = quote({ basePaise: toPaise(8_000), surgeMultiplier: toRate(1) });

const valetTripKm = 3;
const valetTripPaise = VALET_BASE_FEE_PAISE + valetTripKm * VALET_PER_KM_PAISE;
const washExamplePaise = 39_900;

export const PRICING = {
  commissionPercent: pct(PLATFORM_COMMISSION_RATE),
  commissionRate: PLATFORM_COMMISSION_RATE as number,
  ownerKeepsPercent: 100 - pct(PLATFORM_COMMISSION_RATE),
  gstPercent: pct(GST_RATE),
  surgeMaxMultiplier: SURGE_MULTIPLIER_MAX as number,
  waiverSlots: COMMISSION_WAIVER_SLOTS,
  waiverMonths: COMMISSION_WAIVER_MONTHS,
  minimumPayout: rupees(MINIMUM_PAYOUT_PAISE),
  /**
   * Owners choose weekly (Mondays) or monthly (the 1st) payouts, per the task 20 pricing table.
   * Contracts do not model the schedule yet, so it is stated here rather than derived.
   */
  payouts: {
    label: 'Weekly (Monday) or monthly (1st)',
    sentence: 'every Monday, or on the 1st of the month if you prefer',
  },
  example: {
    hours: 2,
    hourly: 40,
    base: rupees(example.basePaise),
    gst: rupees(example.gstPaise),
    driverTotal: rupees(example.driverTotalPaise),
    owner: rupees(example.ownerEarningsPaise),
    parkease: rupees(example.parkeaseFeePaise),
  },
  valet: {
    base: rupees(VALET_BASE_FEE_PAISE),
    perKm: rupees(VALET_PER_KM_PAISE),
    commissionPercent: pct(VALET_COMMISSION_RATE),
    keepsPercent: 100 - pct(VALET_COMMISSION_RATE),
    exampleKm: valetTripKm,
    exampleFee: rupees(valetTripPaise),
    exampleEarns: rupees(valetTripPaise - Math.round(valetTripPaise * VALET_COMMISSION_RATE)),
    noShowGraceMinutes: 10,
  },
  wash: {
    commissionPercent: pct(CARWASH_COMMISSION_RATE),
    keepsPercent: 100 - pct(CARWASH_COMMISSION_RATE),
    examplePrice: rupees(washExamplePaise),
    exampleEarns: Math.floor(
      rupees(washExamplePaise - Math.round(washExamplePaise * CARWASH_COMMISSION_RATE)),
    ),
  },
  refunds: {
    processingFee: rupees(REFUND_PROCESSING_FEE_PAISE),
    graceMinutes: ACTIVE_GRACE_MINUTES,
    gracePercent: pct(ACTIVE_GRACE_REFUND_RATE),
    ownerCancelGoodwill: rupees(OWNER_CANCEL_GOODWILL_PAISE),
  },
} as const;
