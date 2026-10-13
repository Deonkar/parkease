import { spaceSearchItemSchema } from '@parkease/contracts/driver';
import { cursorPageMetaSchema } from '@parkease/contracts/primitives';
import { z } from 'zod';

import { api } from '@/lib/api';

/**
 * The response envelope is `{ data, meta }`. It is parsed, not asserted: a
 * response is data from outside the process, so it goes through Zod like every
 * other boundary (R-VAL-01).
 */
// The contract's meta, not a copy: a hand-written one expected `nextCursor` absent where the API
// sends `null`, so every real search failed to parse (task 22; rule 6, one schema).
const searchResponseSchema = z.object({
  data: z.array(spaceSearchItemSchema),
  meta: cursorPageMetaSchema,
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
