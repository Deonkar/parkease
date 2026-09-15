import { z } from 'zod';

/**
 * A job payload is data that crossed a process boundary and sat in a table, so
 * it is validated like any other untrusted input (R-VAL-01). A relay bug or a
 * hand-inserted row must fail here, loudly, rather than reach a cancel path with
 * a booking id of `undefined`.
 */
export const bookingJobPayloadSchema = z.object({
  bookingId: z.string().uuid(),
});

export type BookingJobPayload = z.infer<typeof bookingJobPayloadSchema>;

export function parseBookingJobPayload(raw: unknown): BookingJobPayload {
  const parsed = bookingJobPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed booking job payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
