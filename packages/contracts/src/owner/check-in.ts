import { z } from 'zod';

import { bookingReferenceTokenSchema } from '../driver/check-in.js';
import { bookingStatusSchema } from '../enums/booking-status.js';
import { checkInMethodSchema } from '../enums/check-in-method.js';
import { bookingIdSchema } from '../primitives/ids.js';

/**
 * The owner scans the driver's QR. Same token, same command, different
 * authorisation context and a different response shape (ADR-016): the owner is
 * told who arrived, not what anything cost.
 */
export const ownerCheckInSchema = z.object({
  token: bookingReferenceTokenSchema,
});

export type OwnerCheckIn = z.infer<typeof ownerCheckInSchema>;

export const ownerCheckInResultSchema = z.object({
  id: bookingIdSchema,
  status: bookingStatusSchema,
  checkedInAt: z.string().datetime(),
  checkInMethod: checkInMethodSchema,
  driverName: z.string(),
  vehicleNumber: z.string().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export type OwnerCheckInResult = z.infer<typeof ownerCheckInResultSchema>;
