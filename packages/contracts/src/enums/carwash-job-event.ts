import { z } from 'zod';

/**
 * What can happen to a car wash job. Paired with `CarwashJobStatus` by the
 * transition table in `washer/lifecycle.ts`, which is the only thing that turns
 * one of these into a status.
 *
 * Six events against seven statuses. The washer's app sends one of these and
 * never a destination status — naming where a job should land is exactly what
 * the machine exists to prevent.
 */
export const CARWASH_JOB_EVENT_VALUES = [
  'offer',
  'accept',
  'en_route',
  'start_washing',
  'complete',
  'cancel',
] as const;

export const carwashJobEventSchema = z.enum(CARWASH_JOB_EVENT_VALUES);
export type CarwashJobEvent = z.infer<typeof carwashJobEventSchema>;

export const CarwashJobEvent = {
  OFFER: 'offer',
  ACCEPT: 'accept',
  EN_ROUTE: 'en_route',
  START_WASHING: 'start_washing',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
} as const satisfies Record<string, CarwashJobEvent>;

type _MissingFromObject = Exclude<
  CarwashJobEvent,
  (typeof CarwashJobEvent)[keyof typeof CarwashJobEvent]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
