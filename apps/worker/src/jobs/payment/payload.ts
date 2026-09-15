import { z } from 'zod';

/**
 * Job payloads crossed a process boundary and sat in a table, so they are
 * validated like any other untrusted input (R-VAL-01). A relay bug or a
 * hand-inserted row must fail here, loudly, rather than reach a gateway call
 * with an amount of `undefined`.
 */
export const issueRefundPayloadSchema = z.object({
  refundId: z.string().uuid(),
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  razorpayPaymentId: z.string().min(1),
  amountPaise: z.number().int().positive(),
});

export type IssueRefundPayload = z.infer<typeof issueRefundPayloadSchema>;

export const orphanCapturePayloadSchema = z.object({
  bookingId: z.string().uuid(),
  paymentId: z.string().uuid(),
  razorpayPaymentId: z.string().min(1),
  capturedPaise: z.number().int().positive(),
  bookingStatus: z.string().min(1),
});

export type OrphanCapturePayload = z.infer<typeof orphanCapturePayloadSchema>;

export function parsePaymentJobPayload<T>(schema: z.ZodType<T>, raw: unknown, job: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed ${job} payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
