import { z } from 'zod';

import { bookingIdSchema } from '../primitives/ids.js';
import { paiseSchema } from '../primitives/paise.js';

export const refundBookingSchema = z.object({
  bookingId: bookingIdSchema,
  amountPaise: paiseSchema,
  reason: z.string().min(1).max(500),
});

export type RefundBooking = z.infer<typeof refundBookingSchema>;
