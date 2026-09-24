import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import {
  useAcceptWash,
  useAdvanceWash,
  useAttachPhoto,
  useCreateProfile,
  useSubmitDocuments,
  useUpsertService,
  washerKeys,
} from '../hooks/useWasherQueries';

/**
 * What the washer mutations do to the cached job when they fail. The rule
 * (T7-S1, ruling T7-I2): refetch only when the SERVER said no — the screen was
 * stale. A transport failure keeps the cached job, because a refetch over a dead
 * connection fails too and the partner loses the screen they were acting on.
 */

interface MutationOptions {
  mutationKey?: readonly unknown[];
  onMutate?: () => Promise<unknown>;
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

const q = vi.hoisted(() => ({
  last: null as MutationOptions | null,
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  cancelQueries: vi.fn(() => Promise.resolve()),
  isMutating: vi.fn(() => 1),
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
    cancelQueries: q.cancelQueries,
    isMutating: q.isMutating,
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
  createProfile: vi.fn(),
  submitDocuments: vi.fn(),
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
  q.setQueryData.mockReset();
  q.cancelQueries.mockClear();
  q.isMutating.mockReset();
  q.isMutating.mockReturnValue(1);
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

/** G1: a 2xx this build could not parse means the cache is stale in unknown ways. */
describe('an out-of-date app', () => {
  const outdated = new ZodError([]);
  const invalidated = (key: readonly unknown[]) =>
    q.invalidateQueries.mock.calls.some(
      (call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === JSON.stringify(key),
    );

  it('refetches the job after an advance whose answer could not be read', () => {
    failWith(useAdvanceWash, outdated);
    expect(invalidated(washerKeys.active)).toBe(true);
  });

  it('refetches the job after an attach whose answer could not be read', () => {
    failWith(useAttachPhoto, outdated);
    expect(invalidated(washerKeys.active)).toBe(true);
  });

  it('refetches the menu after a save whose answer could not be read', () => {
    failWith(useUpsertService, outdated);
    expect(invalidated(washerKeys.menu)).toBe(true);
  });

  it('refetches the profile after a registration whose answer could not be read', () => {
    failWith(useCreateProfile, outdated);
    expect(invalidated(washerKeys.profile)).toBe(true);
    q.invalidateQueries.mockReset();
    failWith(useSubmitDocuments, outdated);
    expect(invalidated(washerKeys.profile)).toBe(true);
  });
});

/** G3: a refused accept may be a verification or onboarding fact, which the profile holds. */
describe('useAcceptWash', () => {
  const invalidated = (key: readonly unknown[]) =>
    q.invalidateQueries.mock.calls.some(
      (call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey) === JSON.stringify(key),
    );

  it('refetches the profile after a refusal', () => {
    failWith(useAcceptWash, refused(403, 'WASHER_NOT_VERIFIED'));
    expect(invalidated(washerKeys.profile)).toBe(true);
  });

  it('leaves the profile alone after a transport failure', () => {
    failWith(useAcceptWash, offline);
    expect(invalidated(washerKeys.profile)).toBe(false);
  });
});

const sameKey = (a: unknown, b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);
const invalidatedKey = (key: readonly unknown[]) =>
  q.invalidateQueries.mock.calls.some((call) =>
    sameKey((call[0] as { queryKey: unknown }).queryKey, key),
  );
const cancelledKey = (key: readonly unknown[]) =>
  q.cancelQueries.mock.calls.some((call) =>
    sameKey((call as unknown as [{ queryKey: unknown }])[0].queryKey, key),
  );

/** H1: the partner who just won must never see "No active job". */
describe('a won accept', () => {
  it('writes the job it won straight into the active cache', () => {
    useAcceptWash();
    const job = { id: 'job-1', status: 'accepted' };
    q.last?.onSuccess?.(job);

    expect(q.setQueryData).toHaveBeenCalledWith(washerKeys.active, job);
  });
});

/**
 * H3: a cache write that races a refetch. `setQueryData` from a mutation can
 * be overwritten by an older refetch landing after it — which is how a stale
 * profile overwrote the ID just uploaded (task 10 minor). Each writer cancels
 * the key's in-flight fetches first, and when another write to the same data
 * is still running it invalidates on settle rather than trusting its own.
 */
describe.each([
  ['useAcceptWash', useAcceptWash, washerKeys.active],
  ['useAdvanceWash', useAdvanceWash, washerKeys.active],
  ['useAttachPhoto', useAttachPhoto, washerKeys.active],
  ['useUpsertService', useUpsertService, washerKeys.menu],
  ['useSubmitDocuments', useSubmitDocuments, washerKeys.profile],
] as const)('%s and a concurrent refetch', (_name, hook, key) => {
  it('cancels in-flight fetches of the key it writes, before it writes', async () => {
    hook();
    await q.last?.onMutate?.();

    expect(cancelledKey(key)).toBe(true);
  });

  it('counts only its own kind of write, by mutation key', () => {
    hook();
    expect(q.last?.mutationKey).toBeDefined();
  });

  it('refetches on settle while another write to the same data is still running', () => {
    hook();
    q.isMutating.mockReturnValue(2);
    q.last?.onSettled?.();

    expect(invalidatedKey(key)).toBe(true);
  });

  it('trusts its own answer when it is the only write running', () => {
    hook();
    q.isMutating.mockReturnValue(1);
    q.last?.onSettled?.();

    // Accept refetches offers and active on every settle regardless (the race).
    if (hook !== useAcceptWash) expect(invalidatedKey(key)).toBe(false);
  });
});
