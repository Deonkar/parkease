import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM, 'Use HH:mm in 24-hour time');

const dayScheduleSchema = z
  .discriminatedUnion('isOpen', [
    z.object({ isOpen: z.literal(false) }),
    z.object({ isOpen: z.literal(true), opensAt: hhmm, closesAt: hhmm }),
  ])
  .refine((d) => !d.isOpen || d.opensAt < d.closesAt, {
    message: 'Closing time must be after opening time',
  });

const weekSchema = z.object({
  mon: dayScheduleSchema,
  tue: dayScheduleSchema,
  wed: dayScheduleSchema,
  thu: dayScheduleSchema,
  fri: dayScheduleSchema,
  sat: dayScheduleSchema,
  sun: dayScheduleSchema,
});

export const spaceScheduleSchema = z.discriminatedUnion('is24x7', [
  z.object({ is24x7: z.literal(true) }),
  z.object({ is24x7: z.literal(false), days: weekSchema }),
]);

export type SpaceSchedule = z.infer<typeof spaceScheduleSchema>;
export type DaySchedule = z.infer<typeof dayScheduleSchema>;
