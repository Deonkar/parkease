import { z } from 'zod';

import { carwashJobEventSchema } from '../enums/carwash-job-event.js';

/**
 * A partner sends an *event*, never a target status.
 *
 * This is the whole point of the state machine: if the body carried `status`,
 * the client would be choosing where the job lands and the server would be
 * agreeing — and a client that can ask for `completed` directly is a client
 * that can walk past both photo gates. `start_washing` is a thing a washer
 * does; `washing` is a conclusion only the transition table draws.
 *
 * Three events are excluded, and none of them is an oversight. `cancel` is the
 * driver's, on their own route. `offer` belongs to dispatch — the API opens
 * round 0 and the worker widens the rest, and a partner who could fire it would
 * be re-offering their own job. `accept` has its own endpoint, because winning
 * the race is a conditional UPDATE and not a status move.
 */
export const advanceWashJobSchema = z.object({
  event: carwashJobEventSchema.exclude(['cancel', 'offer', 'accept']),
});

export type AdvanceWashJob = z.infer<typeof advanceWashJobSchema>;
