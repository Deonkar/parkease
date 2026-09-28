import { z } from 'zod';

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const pageMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

/**
 * Keyset pagination carries no total: counting the whole matching set defeats
 * the point of paging by cursor. Driver search (task 7) and the driver's
 * bookings list (task 8) are both shaped this way.
 */
export const cursorPageMetaSchema = z.object({
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export type CursorPageMeta = z.infer<typeof cursorPageMetaSchema>;

export const single = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
export const page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), meta: pageMetaSchema });

/**
 * The keyset-paged response shape a controller returns before
 * `TransformInterceptor` remaps `items` to the envelope's `data` key
 * (R-ARCH-07 — second use: `earnings.controller.ts` and
 * `bookings.controller.ts` both hand-rolled this exact object).
 */
export const cursorPageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), meta: cursorPageMetaSchema });

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string(),
    traceId: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
