import type { CarwashServiceName, VehicleType } from '@parkease/contracts/enums';
import type { WasherEarningsPeriod } from '@parkease/contracts/washer';

/**
 * How the closed catalogue reads to a partner — in one place, because the
 * offers card, the active job, the menu and the earnings lines all name a
 * service, and four spellings of "Basic Exterior Wash" is how a partner starts
 * wondering whether they are four different jobs.
 *
 * `Record` over the contract's own union, so adding a service to the catalogue
 * fails typecheck here until it has a name.
 */
export const SERVICE_LABELS: Readonly<Record<CarwashServiceName, string>> = {
  basic_exterior: 'Basic Exterior Wash',
  premium_wash: 'Premium Wash',
  interior_only: 'Interior Only',
  full_detailing: 'Full Detailing',
  quick_wipe: 'Quick Wipe',
};

/** Lower-case on purpose: it always follows other words ("for a bike"). */
export const VEHICLE_LABELS: Readonly<Record<VehicleType, string>> = {
  car: 'car',
  two_wheeler: 'bike',
};

export interface PeriodCopy {
  /** On the tab: short, because four sit side by side. */
  readonly tab: string;
  /** Above the headline figure, naming what it covers. */
  readonly heading: string;
  /** The empty list, naming the period so "nothing" is never ambiguous. */
  readonly empty: string;
}

/**
 * The earnings periods, in words. `Record` over the contract's union, so a new
 * period fails typecheck here until it can be named.
 */
export const PERIOD_LABELS: Readonly<Record<WasherEarningsPeriod, PeriodCopy>> = {
  today: { tab: 'Today', heading: 'Today', empty: 'No completed washes today' },
  week: { tab: 'This week', heading: 'This week', empty: 'No completed washes this week' },
  month: { tab: 'This month', heading: 'This month', empty: 'No completed washes this month' },
  all: { tab: 'All', heading: 'All time', empty: 'No completed washes yet' },
};
