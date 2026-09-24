import { z } from 'zod';

import { valetJobEventSchema } from '../enums/valet-job-event.js';
import { uploadIdIn } from '../shared/upload-signature.js';

/**
 * A client sends an *event*, never a target status.
 *
 * This is the whole point of the state machine: if the body carried `status`,
 * the client would be choosing where the job lands and the server would be
 * agreeing. `depart` is a thing a valet does; `en_route` is a conclusion only
 * the transition table is allowed to draw.
 *
 * Four events are excluded, and none of them is an oversight.
 *
 * `cancel` is the driver's, on their own route. `no_show` is the worker's, ten
 * minutes after `arrived` — a valet who could fire it by hand could bill a
 * call-out fee on demand. `request_return` is the driver asking for their car
 * back, and a valet who could fire it would move the job to `return_requested`
 * and post a second charge to the driver's account unasked. `offer` and
 * `accept` belong to dispatch, not to the job's own progress.
 */
export const advanceValetJobSchema = z.object({
  event: valetJobEventSchema.exclude(['cancel', 'no_show', 'offer', 'accept', 'request_return']),
  /** An upload signed into `proofs` — never a URL, never another folder's id. */
  proofPhotoId: uploadIdIn('proofs').optional(),
});

export type AdvanceValetJob = z.infer<typeof advanceValetJobSchema>;
