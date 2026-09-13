import { z } from 'zod';

export const MAX_SLOTS_PER_VEHICLE_TYPE = 50;

export const slotCountsSchema = z
  .object({
    car: z.number().int().min(0).max(MAX_SLOTS_PER_VEHICLE_TYPE),
    twoWheeler: z.number().int().min(0).max(MAX_SLOTS_PER_VEHICLE_TYPE),
  })
  .refine((s) => s.car + s.twoWheeler > 0, {
    message: 'A space needs at least one slot',
  });

export type SlotCounts = z.infer<typeof slotCountsSchema>;
