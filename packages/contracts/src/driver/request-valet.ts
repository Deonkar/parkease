import { z } from 'zod';

import { bookingIdSchema, valetJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';

export const requestValetSchema = z.object({
  bookingId: bookingIdSchema,
  pickup: geoPointSchema.extend({
    address: z.string().min(1).max(255),
  }),
});

export type RequestValet = z.infer<typeof requestValetSchema>;

export const requestValetReturnSchema = z.object({
  dropLocation: geoPointSchema.extend({
    address: z.string().min(1).max(255),
  }),
});

export type RequestValetReturn = z.infer<typeof requestValetReturnSchema>;

export const cancelValetSchema = z.object({
  reason: z.string().max(255).optional(),
});

export type CancelValet = z.infer<typeof cancelValetSchema>;

export const valetJobIdParamSchema = z.object({ id: valetJobIdSchema });
