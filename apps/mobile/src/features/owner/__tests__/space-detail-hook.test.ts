import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fix wave 4, W1 (headless browser walk): `useSpaceDetail` had no dev-mock
 * path, so under a dev-mock session the listing detail screen hit the
 * network, Metro answered its HTML shell, and TanStack rejected on a
 * malformed body — "Could not load listing". Mirrors `useMyListings.ts`:
 * `isDevMockSession()` gates a read from the in-memory `dev-mock-store`
 * before ever calling `fetchSpaceDetail`. `useQuery` itself is mocked (the
 * `create-space-hook.test.ts` style) so this proves the `queryFn` branches
 * without a live cache, react-native, or a rendered tree.
 */

interface QueryOptions {
  queryFn: () => unknown;
}

const q = vi.hoisted(() => ({ last: null as QueryOptions | null }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: QueryOptions) => {
    q.last = options;
    return options;
  },
}));

const m = vi.hoisted(() => ({
  isDevMockSession: vi.fn<() => Promise<boolean>>(),
  findDevMockSpace: vi.fn(),
  fetchSpaceDetail: vi.fn(),
}));

vi.mock('@/lib/dev-mock', () => ({ isDevMockSession: m.isDevMockSession }));
vi.mock('@/lib/dev-mock-store', () => ({ findDevMockSpace: m.findDevMockSpace }));
vi.mock('../api/spaces', () => ({ fetchSpaceDetail: m.fetchSpaceDetail }));

beforeEach(() => {
  q.last = null;
  m.isDevMockSession.mockReset();
  m.findDevMockSpace.mockReset();
  m.fetchSpaceDetail.mockReset();
});

describe('useSpaceDetail', () => {
  it('serves the space from the dev-mock store when it is found', async () => {
    m.isDevMockSession.mockResolvedValue(true);
    const space = { id: 'space-1', title: 'Mock Space' };
    m.findDevMockSpace.mockReturnValue(space);

    const { useSpaceDetail } = await import('../hooks/useSpaceDetail');
    useSpaceDetail('space-1');

    await expect(q.last?.queryFn()).resolves.toBe(space);
    expect(m.findDevMockSpace).toHaveBeenCalledWith('space-1');
    expect(m.fetchSpaceDetail).not.toHaveBeenCalled();
  });

  it('rejects with a typed error, not undefined, when the id is not in the dev-mock store (R-FAIL-01)', async () => {
    m.isDevMockSession.mockResolvedValue(true);
    m.findDevMockSpace.mockReturnValue(undefined);

    const { useSpaceDetail } = await import('../hooks/useSpaceDetail');
    useSpaceDetail('missing-space');

    await expect(q.last?.queryFn()).rejects.toThrow('That listing is not in this dev session.');
    expect(m.fetchSpaceDetail).not.toHaveBeenCalled();
  });

  it('reads the network outside a dev-mock session', async () => {
    m.isDevMockSession.mockResolvedValue(false);
    const space = { id: 'space-1', title: 'Network Space' };
    m.fetchSpaceDetail.mockResolvedValue(space);

    const { useSpaceDetail } = await import('../hooks/useSpaceDetail');
    useSpaceDetail('space-1');

    await expect(q.last?.queryFn()).resolves.toBe(space);
    expect(m.fetchSpaceDetail).toHaveBeenCalledWith('space-1');
    expect(m.findDevMockSpace).not.toHaveBeenCalled();
  });
});
