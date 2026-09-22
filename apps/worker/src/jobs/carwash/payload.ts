import { z } from 'zod';

/**
 * A job payload is data that crossed a process boundary and sat in a table, so
 * it is validated like any other untrusted input (R-VAL-01). A relay bug or a
 * hand-inserted row must fail here, loudly, rather than reach a cancel path
 * with a job id of `undefined`.
 */
export const carwashAcceptTimeoutPayloadSchema = z.object({
  jobId: z.string().uuid(),
  round: z.number().int().nonnegative(),
});

export type CarwashAcceptTimeoutPayload = z.infer<typeof carwashAcceptTimeoutPayloadSchema>;

export const carwashCompleteReminderPayloadSchema = z.object({
  jobId: z.string().uuid(),
});

export type CarwashCompleteReminderPayload = z.infer<typeof carwashCompleteReminderPayloadSchema>;

export function parseCarwashJobPayload<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed car wash job payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
