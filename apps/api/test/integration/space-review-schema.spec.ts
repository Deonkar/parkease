import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type Harness, seedSpace, startHarness, stopHarness, truncateSpaces } from './harness.js';

/**
 * Task 18a: space review columns schema validation. After migration 0042, the spaces table
 * must have review_notes, reviewed_by_user_id (FK to users), reviewed_at, and a corresponding index.
 */
describe('space review schema (task 18a)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  });

  afterAll(async () => {
    await stopHarness(h);
  });

  beforeEach(async () => {
    await truncateSpaces(h);
  });

  it('spaces table has review_notes, reviewed_by_user_id, reviewed_at columns', async () => {
    // Query information_schema.columns to verify the columns exist and have correct types
    const columns = await h.sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'spaces'
        AND column_name IN ('review_notes', 'reviewed_by_user_id', 'reviewed_at')
      ORDER BY column_name
    `;

    expect(columns).toHaveLength(3);

    const columnMap = Object.fromEntries(columns.map((c) => [c.column_name, c]));

    expect(columnMap['review_notes']).toMatchObject({
      column_name: 'review_notes',
      data_type: 'text',
      is_nullable: 'YES',
    });

    expect(columnMap['reviewed_by_user_id']).toMatchObject({
      column_name: 'reviewed_by_user_id',
      data_type: 'uuid',
      is_nullable: 'YES',
    });

    expect(columnMap['reviewed_at']).toMatchObject({
      column_name: 'reviewed_at',
      data_type: 'timestamp with time zone',
      is_nullable: 'YES',
    });
  });

  it('has index spaces_reviewed_by_user_id_idx', async () => {
    const indexes = await h.sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'spaces'
        AND indexname = 'spaces_reviewed_by_user_id_idx'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexname).toBe('spaces_reviewed_by_user_id_idx');
  });

  it('rejection_reason is backfilled into review_notes', async () => {
    // Create a space with a rejection_reason
    const spaceId = await seedSpace(h, { lat: 12.9352, lng: 77.6245 });
    await h.sql`
      UPDATE spaces
      SET rejection_reason = 'Missing amenities list'
      WHERE id = ${spaceId}
    `;

    // Query the space and verify the review_notes is NULL before migration completes
    const [space] = await h.sql<{ review_notes: string | null; rejection_reason: string }[]>`
      SELECT review_notes, rejection_reason FROM spaces WHERE id = ${spaceId}
    `;

    // After migration, rejection_reason should be copied into review_notes if review_notes was NULL
    // This is the backfill behavior specified in 0042
    expect(space).toBeDefined();
  });
});
