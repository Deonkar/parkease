import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MY_LISTINGS_KEY } from '../hooks/useMyListings';
import { ownerKeys } from '../hooks/useOwnerQueries';

/**
 * F7 (browser walk): creating or updating a space must also invalidate the
 * dashboard, or the dashboard's empty state ("List your first space") and
 * its space list, occupancy and today's booking count go stale the moment
 * an owner adds, edits, or later removes a listing. Mirrors the washer
 * queries' `useMutation`/`useQueryClient` mock style so this proves the
 * wiring without a live query cache or network/dev-mock branch.
 */

interface MutationOptions {
  mutationFn?: (...args: unknown[]) => unknown;
  onSuccess?: () => void;
}

const q = vi.hoisted(() => ({
  last: null as MutationOptions | null,
  invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => {
    q.last = options;
    return options;
  },
  useQueryClient: () => ({ invalidateQueries: q.invalidateQueries }),
}));

vi.mock('../api/spaces', () => ({
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ newIntent: vi.fn(() => ({ idempotencyKey: 'intent-1' })) }));
vi.mock('@/lib/dev-mock', () => ({ isDevMockSession: vi.fn(() => Promise.resolve(false)) }));
vi.mock('@/lib/dev-mock-store', () => ({ addDevMockSpace: vi.fn() }));
vi.mock('@/lib/uuid', () => ({ uuidv7: vi.fn(() => '0192f2c0-0000-7000-8000-000000000099') }));

const sameKey = (a: unknown, b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const invalidated = (key: readonly unknown[]) =>
  q.invalidateQueries.mock.calls.some((call) =>
    sameKey((call[0] as { queryKey: unknown }).queryKey, key),
  );

beforeEach(() => {
  q.last = null;
  q.invalidateQueries.mockReset();
});

describe('useCreateSpace', () => {
  it('invalidates the owner dashboard along with the listings (F7)', async () => {
    const { useCreateSpace } = await import('../hooks/useCreateSpace');
    useCreateSpace();
    q.last?.onSuccess?.();

    expect(invalidated(MY_LISTINGS_KEY)).toBe(true);
    expect(invalidated(ownerKeys.dashboard)).toBe(true);
  });
});

describe('useUpdateSpace', () => {
  it('invalidates the owner dashboard along with the listing and its detail (F7)', async () => {
    const { useUpdateSpace } = await import('../hooks/useUpdateSpace');
    useUpdateSpace('space-1');
    q.last?.onSuccess?.();

    expect(invalidated(MY_LISTINGS_KEY)).toBe(true);
    expect(invalidated(['owner', 'space', 'space-1'])).toBe(true);
    expect(invalidated(ownerKeys.dashboard)).toBe(true);
  });
});
