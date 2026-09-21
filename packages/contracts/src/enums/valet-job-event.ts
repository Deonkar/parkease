import { z } from 'zod';

/**
 * What can happen to a valet job. Paired with `ValetJobStatus` by the transition
 * table in `valet/lifecycle.ts`, which is the only thing that turns one of these
 * into a status.
 */
export const VALET_JOB_EVENT_VALUES = [
  'offer',
  'accept',
  'depart',
  'arrive',
  'start_parking',
  'confirm_parked',
  'request_return',
  'depart_return',
  'complete',
  'cancel',
  'no_show',
] as const;

export const valetJobEventSchema = z.enum(VALET_JOB_EVENT_VALUES);
export type ValetJobEvent = z.infer<typeof valetJobEventSchema>;

export const ValetJobEvent = {
  OFFER: 'offer',
  ACCEPT: 'accept',
  DEPART: 'depart',
  ARRIVE: 'arrive',
  START_PARKING: 'start_parking',
  CONFIRM_PARKED: 'confirm_parked',
  REQUEST_RETURN: 'request_return',
  DEPART_RETURN: 'depart_return',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
  NO_SHOW: 'no_show',
} as const satisfies Record<string, ValetJobEvent>;

type _MissingFromObject = Exclude<
  ValetJobEvent,
  (typeof ValetJobEvent)[keyof typeof ValetJobEvent]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
