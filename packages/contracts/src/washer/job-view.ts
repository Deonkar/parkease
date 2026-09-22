import { z } from 'zod';

import { carwashJobStatusSchema } from '../enums/carwash-job-status.js';
import { carwashServiceNameSchema } from '../enums/carwash-service-name.js';
import { vehicleTypeSchema } from '../enums/vehicle-type.js';
import { bookingIdSchema, washJobIdSchema } from '../primitives/ids.js';
import { geoPointSchema } from '../primitives/indian.js';
import { paiseSchema } from '../primitives/paise.js';

/** The one live job a partner is on. */
export const washJobViewSchema = z.object({
  id: washJobIdSchema,
  bookingId: bookingIdSchema,
  status: carwashJobStatusSchema,
  serviceName: carwashServiceNameSchema,
  vehicleType: vehicleTypeSchema,
  spaceLocation: geoPointSchema,
  /** The partner's take-home, frozen at accept. Null until somebody accepts. */
  earningsPaise: paiseSchema.nullable(),
  /** Which events the machine will accept next, so the app renders one button. */
  availableEvents: z.array(z.string()),
  beforePhotoId: z.string().nullable(),
  afterPhotoId: z.string().nullable(),
  acceptedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export type WashJobView = z.infer<typeof washJobViewSchema>;

/**
 * Ledger-derived, gross and net.
 *
 * Three numbers rather than two, because gross and net differ for a reason a
 * partner is owed an explanation of: a job cancelled after they accepted claws
 * the credited amount back, and a screen showing only the net leaves them
 * unable to see that a reversal happened at all.
 *
 * There is deliberately no `commissionPaise`. Commission is credited to
 * `platform_revenue`, not to this account, so reporting it here would mean
 * either a second query or quietly relabelling the clawback total as
 * commission — and a wrong label on a money screen is worse than an absent one.
 */
export const washerEarningsSummarySchema = z.object({
  /** Credits to this partner across every job, before any reversal. */
  grossPaise: paiseSchema,
  /** Debits: what a cancellation clawed back. */
  reversedPaise: paiseSchema,
  /** What the ledger says we owe this partner right now. */
  netPaise: paiseSchema,
  jobsCompleted: z.number().int().nonnegative(),
});

export type WasherEarningsSummary = z.infer<typeof washerEarningsSummarySchema>;
