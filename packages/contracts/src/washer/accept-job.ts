import { z } from 'zod';

/**
 * Accepting carries no body.
 *
 * A valet's accept sends their current position, because the outbound leg is
 * priced from it. A wash is not: the price comes from the partner's own menu
 * row for this `(service_name, vehicle_type)`, which the server reads and
 * freezes. There is nothing a client could add here that the server would
 * believe, so the schema says so rather than leaving the body unvalidated.
 */
export const acceptWashJobSchema = z.object({});

export type AcceptWashJob = z.infer<typeof acceptWashJobSchema>;
