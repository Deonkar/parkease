import { z } from 'zod';

import { valetJobEventSchema } from '../enums/valet-job-event.js';

/**
 * A client sends an *event*, never a target status.
 *
 * This is the whole point of the state machine: if the body carried `status`,
 * the client would be choosing where the job lands and the server would be
 * agreeing. `depart` is a thing a valet does; `en_route` is a conclusion only
 * the transition table is allowed to draw.
 *
 * `cancel` and `no_show` are excluded — neither is a valet's to declare. A
 * cancel is the driver's, on their own route; a no-show is the worker's, ten
 * minutes after `arrived`, and a valet who could fire it by hand could bill a
 * call-out fee on demand.
 */
export const advanceValetJobSchema = z.object({
  event: valetJobEventSchema.exclude(['cancel', 'no_show', 'offer', 'accept']),
  proofPhotoId: z.string().min(1).max(255).optional(),
});

export type AdvanceValetJob = z.infer<typeof advanceValetJobSchema>;
