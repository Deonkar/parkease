import { z } from 'zod';

export const VALET_JOB_STATUS_VALUES = [
  'requested',
  'offered',
  'accepted',
  'en_route',
  'arrived',
  'parking',
  'parked',
  'return_requested',
  'returning',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const valetJobStatusSchema = z.enum(VALET_JOB_STATUS_VALUES);
export type ValetJobStatus = z.infer<typeof valetJobStatusSchema>;

export const ValetJobStatus = {
  REQUESTED: 'requested',
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  EN_ROUTE: 'en_route',
  ARRIVED: 'arrived',
  PARKING: 'parking',
  PARKED: 'parked',
  RETURN_REQUESTED: 'return_requested',
  RETURNING: 'returning',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
} as const satisfies Record<string, ValetJobStatus>;

type _MissingFromObject = Exclude<
  ValetJobStatus,
  (typeof ValetJobStatus)[keyof typeof ValetJobStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
