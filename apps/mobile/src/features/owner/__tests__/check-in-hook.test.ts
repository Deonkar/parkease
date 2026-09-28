import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MY_LISTINGS_KEY } from '../hooks/useMyListings';
import { ownerKeys } from '../hooks/useOwnerQueries';

/**
 * I2: a check-in moves a booking from "Upcoming" to "Active" on the listing
 * detail and changes the dashboard's today figures, so a successful scan must
 * invalidate every owner query. Same mock style as `create-space-hook.test.ts`:
 * this proves the wiring without a live query cache or the network.
 */

interface MutationOptions {
  mutationFn?: (vars: { bookingId: string; token: string }) => unknown;
  onSuccess?: () => void;
}

const q = vi.hoisted(() => ({
  last: null as MutationOptions | null,
  invalidateQueries: vi.fn(),
  ownerCheckIn: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => {
    q.last = options;
    return options;
  },
  useQueryClient: () => ({ invalidateQueries: q.invalidateQueries }),
}));

vi.mock('../api/check-in', () => ({ ownerCheckIn: q.ownerCheckIn }));
vi.mock('@/lib/api', () => ({ newIntent: vi.fn(() => ({ idempotencyKey: 'intent-1' })) }));
// Imported for MY_LISTINGS_KEY only; both reach native storage.
vi.mock('@/lib/dev-mock', () => ({ isDevMockSession: vi.fn() }));
vi.mock('@/lib/dev-mock-store', () => ({ listDevMockSpaces: vi.fn() }));

beforeEach(() => {
  q.last = null;
  q.invalidateQueries.mockReset();
  q.ownerCheckIn.mockReset();
});

describe('useOwnerCheckIn', () => {
  it('invalidates every owner query on success, so listing detail and the dashboard refresh (I2)', async () => {
    const { useOwnerCheckIn } = await import('../hooks/useOwnerCheckIn');
    useOwnerCheckIn();
    q.last?.onSuccess?.();

    expect(q.invalidateQueries).toHaveBeenCalledWith({ queryKey: ownerKeys.all });
    // The prefix really does cover the screens that went stale.
    for (const key of [
      ownerKeys.dashboard,
      ownerKeys.spaceBookings('space-1', 'upcoming'),
      MY_LISTINGS_KEY,
    ]) {
      expect(key[0]).toBe(ownerKeys.all[0]);
    }
  });

  it('checks in the scanned booking under a fresh intent', async () => {
    const { useOwnerCheckIn } = await import('../hooks/useOwnerCheckIn');
    useOwnerCheckIn();
    await q.last?.mutationFn?.({ bookingId: 'b-1', token: 'tok' });

    expect(q.ownerCheckIn).toHaveBeenCalledWith('b-1', 'tok', { idempotencyKey: 'intent-1' });
  });
});
