import dayjs, { type Dayjs } from 'dayjs';

/** An IST calendar range; the API treats `to` as exclusive, so the picker's last day is sent +1. */
export type Range = [Dayjs, Dayjs];

export const lastDays = (n: number): Range => [dayjs().subtract(n - 1, 'day'), dayjs()];

export const rangeQuery = ([from, to]: Range) => ({
  from: from.format('YYYY-MM-DD'),
  to: to.add(1, 'day').format('YYYY-MM-DD'),
});
