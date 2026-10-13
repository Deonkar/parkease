import { z } from 'zod';

/**
 * Shared by every admin table that pages by number. Query params arrive as strings,
 * hence `coerce`. Defined once because six lists must agree on the same bounds.
 */
export const adminPageQuerySchema = z.object({
  // Bounded (S-142): an unbounded page reached Postgres as OFFSET 1e300 and answered 500. Past
  // 10,000 pages of 100 a list is filtered, not paged.
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminPageQuery = z.infer<typeof adminPageQuerySchema>;

/** An IST calendar date, `2026-10-06`. A datetime is rejected on purpose: ranges are whole days. */
export const istDateSchema = z.string().date();

/** The keyset window shared by the ledger explorer and the audit log. */
export const adminCursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type AdminCursorQuery = z.infer<typeof adminCursorQuerySchema>;
