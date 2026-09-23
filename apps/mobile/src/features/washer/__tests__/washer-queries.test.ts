import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdvanceWash, useAttachPhoto, washerKeys } from '../hooks/useWasherQueries';

/**
 * What the washer mutations do to the cached job when they fail. The rule
 * (T7-S1, ruling T7-I2): refetch only when the SERVER said no — the screen was
 * stale. A transport failure keeps the cached job, because a refetch over a dead
 * connection fails too and the partner loses the screen they were acting on.
 */

interface MutationOptions {
  onError?: (error: unknown) => void;
}

const q = vi.hoisted(() => ({
  last: null as MutationOptions | null,
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: MutationOptions) => {
    q.last = options;
    return options;
  },
  useQuery: vi.fn(),
  useQueryClient: () => ({
    invalidateQueries: q.invalidateQueries,
    setQueryData: q.setQueryData,
  }),
}));

vi.mock('../api/washer', () => ({
  acceptOffer: vi.fn(),
  advanceJob: vi.fn(),
  attachPhoto: vi.fn(),
  fetchActiveJob: vi.fn(),
  fetchEarnings: vi.fn(),
  fetchMenu: vi.fn(),
  fetchOffers: vi.fn(),
  fetchProfile: vi.fn(),
  upsertService: vi.fn(),
}));

const refused = (status: number, code: string) => ({
  response: { status, data: { error: { code, message: 'no', traceId: 't' } } },
});
const offline = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const failWith = (hook: () => unknown, error: unknown) => {
  hook();
  q.last?.onError?.(error);
};

const refetchedActive = () =>
  q.invalidateQueries.mock.calls.some(
    (call) =>
      JSON.stringify((call[0] as { queryKey: unknown }).queryKey) ===
      JSON.stringify(washerKeys.active),
  );

beforeEach(() => {
  q.last = null;
  q.invalidateQueries.mockReset();
});

describe('useAttachPhoto', () => {
  it('refetches the job when the server says the slot has closed (T7-S1)', () => {
    failWith(useAttachPhoto, refused(409, 'PHOTO_SLOT_CLOSED'));

    expect(refetchedActive()).toBe(true);
  });

  it('keeps the cached job through a transport failure', () => {
    failWith(useAttachPhoto, offline);

    expect(refetchedActive()).toBe(false);
  });
});

describe('useAdvanceWash', () => {
  it.each([
    [409, 'ILLEGAL_CARWASH_TRANSITION'],
    [400, 'BEFORE_PHOTO_REQUIRED'],
    [400, 'AFTER_PHOTO_REQUIRED'],
  ])(
    'refetches on a definite refusal (%s %s) so a stale screen corrects itself',
    (status, code) => {
      failWith(useAdvanceWash, refused(status, code));

      expect(refetchedActive()).toBe(true);
    },
  );

  it('keeps the cached job when the request never reached the server', () => {
    failWith(useAdvanceWash, offline);

    expect(refetchedActive()).toBe(false);
  });

  it('keeps the cached job through a server error — that answer says nothing about the job', () => {
    failWith(useAdvanceWash, refused(503, 'ERROR'));

    expect(refetchedActive()).toBe(false);
  });
});
