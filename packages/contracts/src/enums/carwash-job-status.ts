import { z } from 'zod';

export const CARWASH_JOB_STATUS_VALUES = [
  'requested',
  'offered',
  'accepted',
  'en_route',
  'washing',
  'completed',
  'cancelled',
] as const;

export const carwashJobStatusSchema = z.enum(CARWASH_JOB_STATUS_VALUES);
export type CarwashJobStatus = z.infer<typeof carwashJobStatusSchema>;

export const CarwashJobStatus = {
  REQUESTED: 'requested',
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  EN_ROUTE: 'en_route',
  WASHING: 'washing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const satisfies Record<string, CarwashJobStatus>;

type _MissingFromObject = Exclude<
  CarwashJobStatus,
  (typeof CarwashJobStatus)[keyof typeof CarwashJobStatus]
>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
