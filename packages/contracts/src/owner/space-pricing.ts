import { z } from 'zod';

import { paiseSchema } from '../primitives/paise.js';

const durationPricingSchema = z
  .object({
    hourlyPaise: paiseSchema,
    dailyPaise: paiseSchema.optional(),
    weeklyPaise: paiseSchema.optional(),
    monthlyPaise: paiseSchema.optional(),
  })
  .refine((p) => p.hourlyPaise > 0, { message: 'Hourly price must be positive' });

export const spacePricingSchema = z
  .object({
    car: durationPricingSchema.optional(),
    twoWheeler: durationPricingSchema.optional(),
  })
  .refine((p) => p.car !== undefined || p.twoWheeler !== undefined, {
    message: 'Set pricing for at least one vehicle type',
  });

export type SpacePricing = z.infer<typeof spacePricingSchema>;
export type DurationPricing = z.infer<typeof durationPricingSchema>;
