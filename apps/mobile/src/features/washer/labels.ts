import type { WasherEarningsPeriod } from '@parkease/contracts/washer';

/** Shared with the driver's wash screens; re-exported so partner code keeps one import. */
export { SERVICE_LABELS, VEHICLE_LABELS } from '../shared/carwash-labels';

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
