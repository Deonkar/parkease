import { z } from 'zod';

export const DURATION_TYPE_VALUES = ['hourly', 'daily', 'weekly', 'monthly'] as const;

export const durationTypeSchema = z.enum(DURATION_TYPE_VALUES);
export type DurationType = z.infer<typeof durationTypeSchema>;

export const DurationType = {
  HOURLY: 'hourly',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const satisfies Record<string, DurationType>;

type _MissingFromObject = Exclude<DurationType, (typeof DurationType)[keyof typeof DurationType]>;
const _exhaustive: _MissingFromObject extends never ? true : never = true;
void _exhaustive;
