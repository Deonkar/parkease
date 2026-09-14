import { spaceSearchItemSchema } from '@parkease/contracts/driver';
import { z } from 'zod';

import { api } from '@/lib/api';

/**
 * The response envelope is `{ data, meta }`. It is parsed, not asserted: a
 * response is data from outside the process, so it goes through Zod like every
 * other boundary (R-VAL-01).
 */
const searchMetaSchema = z.object({
  limit: z.number().int(),
  hasMore: z.boolean(),
  nextCursor: z.string().optional(),
});

const searchResponseSchema = z.object({
  data: z.array(spaceSearchItemSchema),
  meta: searchMetaSchema,
});

export type SpaceSearchPage = z.infer<typeof searchResponseSchema>;

export type SearchQueryParams = Record<string, string | number>;

export async function searchSpaces(
  params: SearchQueryParams,
  signal?: AbortSignal,
): Promise<SpaceSearchPage> {
  const response = await api.get<unknown>('/driver/spaces', { params, signal });
  return searchResponseSchema.parse(response.data);
}
