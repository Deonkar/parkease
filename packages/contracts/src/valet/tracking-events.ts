import { z } from 'zod';

import { valetJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';

/** Inbound: the client asks to watch one job. */
export const valetSubscribeSchema = z.object({
  jobId: valetJobIdSchema,
});

export type ValetSubscribe = z.infer<typeof valetSubscribeSchema>;

/**
 * Inbound, from the valet app only.
 *
 * Validated like any other boundary (R-VAL-01): a socket frame is untrusted
 * input that skipped every HTTP pipe, so nothing downstream may assume a
 * latitude is a number in range.
 */
export const valetLocationSchema = geoPointSchema.extend({
  jobId: valetJobIdSchema,
  headingDeg: z.number().min(0).lt(360).optional(),
  speedKph: z.number().min(0).max(300).optional(),
});

export type ValetLocationUpdate = z.infer<typeof valetLocationSchema>;

/**
 * Outbound, and what Redis holds.
 *
 * Parsed on the way *out* of the cache as well as on the way in: a cached value
 * is data that left the process and came back, so it is re-validated rather than
 * cast (R-VAL-01). A key poisoned by hand cannot become a position on a map.
 */
export const valetLocationViewSchema = geoPointSchema.extend({
  headingDeg: z.number().min(0).lt(360).optional(),
  speedKph: z.number().min(0).max(300).optional(),
  at: z.number().int().positive(),
});

export type ValetLocationView = z.infer<typeof valetLocationViewSchema>;

/** Outbound: a lifecycle move, pushed to whoever is watching the job. */
export const valetStatusEventSchema = z.object({
  jobId: valetJobIdSchema,
  status: z.string(),
  at: z.number().int().positive(),
});

export type ValetStatusEvent = z.infer<typeof valetStatusEventSchema>;

export const VALET_TRACKING_NAMESPACE = '/valet-tracking';

/** Both directions use these names; the gateway and the app import them. */
export const ValetSocketEvent = {
  SUBSCRIBE: 'valet:subscribe',
  LOCATION: 'valet:location',
  STATUS: 'valet:status',
  ERROR: 'valet:error',
} as const;
