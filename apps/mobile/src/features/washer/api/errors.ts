import { z } from 'zod';

/**
 * The washer's failure reading. The classifier itself is shared since S-76
 * (`features/shared/api/failure.ts`); only the washer's own domain answer
 * lives here.
 */
export * from '@/features/shared/api/failure';

const washerNotFoundSchema = z.object({
  response: z.object({
    status: z.number().int(),
    data: z.object({ error: z.object({ code: z.string() }) }),
  }),
});

/**
 * `GET /washer/profile` answers 404 `WASHER_PROFILE_NOT_FOUND` for a washer who
 * has not registered — a first-run state with a next step, not an error. Both
 * the status AND the domain code are required, so a proxy's 404 page, or a bare
 * Nest 404 (whose code is `'ERROR'`), stays an error.
 */
export function isUnregisteredWasher(error: unknown): boolean {
  const parsed = washerNotFoundSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.response.status === 404 &&
    parsed.data.response.data.error.code === 'WASHER_PROFILE_NOT_FOUND'
  );
}
