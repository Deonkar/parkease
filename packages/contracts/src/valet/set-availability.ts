import { z } from 'zod';

import { geoPointSchema } from '../primitives/indian.js';

/**
 * Online/offline, plus the heartbeat fix that makes "online" mean reachable.
 *
 * The location is optional on the way *offline* and required on the way on: a
 * valet with no position cannot be matched to anything, so accepting
 * `{ isOnline: true }` with no fix would put a partner in the pool that every
 * candidate query then silently skips.
 */
export const setValetAvailabilitySchema = z
  .object({
    isOnline: z.boolean(),
    location: geoPointSchema.optional(),
  })
  .refine((v) => !v.isOnline || v.location !== undefined, {
    message: 'a location is required to go online',
    path: ['location'],
  });

export type SetValetAvailability = z.infer<typeof setValetAvailabilitySchema>;
