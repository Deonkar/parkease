import { z } from 'zod';

export const cancelBookingSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export type CancelBooking = z.infer<typeof cancelBookingSchema>;
