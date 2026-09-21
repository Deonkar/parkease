import { z } from 'zod';

/**
 * A job payload is data that crossed a process boundary and sat in a table, so
 * it is validated like any other untrusted input (R-VAL-01). A relay bug or a
 * hand-inserted row must fail here, loudly, rather than reach a cancel path with
 * a job id of `undefined`.
 */
export const acceptTimeoutPayloadSchema = z.object({
  jobId: z.string().uuid(),
  round: z.number().int().nonnegative(),
});

export type AcceptTimeoutPayload = z.infer<typeof acceptTimeoutPayloadSchema>;

export const noShowPayloadSchema = z.object({
  jobId: z.string().uuid(),
});

export type NoShowPayload = z.infer<typeof noShowPayloadSchema>;

export function parseValetJobPayload<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Malformed valet job payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
