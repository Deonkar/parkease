import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
  },
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

const {
  canPayForWash,
  canRequestReturn,
  formatPartnerRating,
  VALET_STATUS_COPY,
  valetIsLive,
  washIsLive,
} = await import('../addon-copy');
const store = await import('../addon-store');
const { checkMeetingPoint, MAX_ADDRESS_LENGTH } = await import('../meeting-point');
const { fixFreshness, newerFix, staleFixLabel, STALE_FIX_MS } = await import('../valet-tracking');
const { warn } = await import('@/lib/log');
const { BOOKING_ID, valetJob, washJob } = await import('./addon-fixtures');

describe('add-on status rules', () => {
  it('offers the return only from parked, mirroring the state machine', () => {
    expect(canRequestReturn(valetJob({ status: 'parked', valet: null }))).toBe(true);
    for (const status of ['offered', 'parking', 'returning', 'completed'] as const) {
      expect(canRequestReturn(valetJob({ status }))).toBe(false);
    }
  });

  it('stops polling a finished job', () => {
    expect(valetIsLive(valetJob({ status: 'en_route' }))).toBe(true);
    expect(valetIsLive(valetJob({ status: 'completed' }))).toBe(false);
    expect(washIsLive(washJob({ status: 'washing' }))).toBe(true);
    expect(washIsLive(washJob({ status: 'cancelled' }))).toBe(false);
  });

  it('offers Pay once a price exists, never twice, never on a dead job', () => {
    expect(canPayForWash(washJob(), false)).toBe(true);
    expect(canPayForWash(washJob(), true)).toBe(false);
    expect(
      canPayForWash(
        washJob({ status: 'offered', pricePaise: null, gstPaise: null, driverTotalPaise: null }),
        false,
      ),
    ).toBe(false);
    expect(canPayForWash(washJob({ status: 'cancelled' }), false)).toBe(false);
  });

  it('names every valet status', () => {
    expect(VALET_STATUS_COPY.arrived.label).toBe('Valet arrived');
  });

  it('says New rather than a zero rating', () => {
    expect(formatPartnerRating(null, 0)).toBe('New');
    expect(formatPartnerRating(42_000, 12)).toBe('4.2 ★ (12)');
  });
});

describe('addon-store', () => {
  beforeEach(() => {
    storage.clear();
    vi.mocked(warn).mockClear();
  });

  it('remembers the jobs a booking has, under the session prefix', async () => {
    await store.rememberValetJob(BOOKING_ID, 'valet-1');
    await store.rememberWashJob(BOOKING_ID, 'wash-1');
    await store.rememberWashJob(BOOKING_ID, 'wash-1');
    await store.rememberWashPaid(BOOKING_ID, 'wash-1');

    expect(store.ADDONS_STORAGE_KEY.startsWith('parkease.')).toBe(true);
    await expect(store.readBookingAddons(BOOKING_ID)).resolves.toEqual({
      valetJobId: 'valet-1',
      washJobIds: ['wash-1'],
      paidWashJobIds: ['wash-1'],
    });
    await expect(store.readBookingAddons('another')).resolves.toEqual(store.NO_ADDONS);
  });

  it('drops an unreadable record with a warning instead of throwing at the screen', async () => {
    storage.set(store.ADDONS_STORAGE_KEY, '{not json');
    await expect(store.readBookingAddons(BOOKING_ID)).resolves.toEqual(store.NO_ADDONS);
    expect(warn).toHaveBeenCalled();
  });
});

describe('mergeAddons (S-148)', () => {
  it('takes the server list as the truth and keeps what only this device knows yet', () => {
    expect(
      store.mergeAddons(
        {
          valetJobId: null,
          washJobs: [
            { id: 'wash-1', paid: false },
            { id: 'wash-2', paid: true },
          ],
        },
        { valetJobId: 'valet-1', washJobIds: ['wash-3', 'wash-1'], paidWashJobIds: ['wash-1'] },
      ),
    ).toEqual({
      valetJobId: 'valet-1',
      washJobIds: ['wash-1', 'wash-2', 'wash-3'],
      paidWashJobIds: ['wash-2', 'wash-1'],
    });
  });

  it('finds the jobs on a phone that remembers nothing (a reinstall)', () => {
    expect(
      store.mergeAddons(
        { valetJobId: 'valet-9', washJobs: [{ id: 'wash-9', paid: true }] },
        store.NO_ADDONS,
      ),
    ).toEqual({ valetJobId: 'valet-9', washJobIds: ['wash-9'], paidWashJobIds: ['wash-9'] });
  });
});

describe('checkMeetingPoint', () => {
  it('needs a location', () => {
    expect(checkMeetingPoint({ point: null, address: 'Gate 2' }).ok).toBe(false);
  });

  it('needs words for it', () => {
    expect(checkMeetingPoint({ point: { lat: 1, lng: 2 }, address: '  ' }).ok).toBe(false);
  });

  it('trims and bounds the address to the contract', () => {
    const check = checkMeetingPoint({
      point: { lat: 1, lng: 2 },
      address: ` ${'a'.repeat(400)} `,
    });
    expect(check).toEqual({
      ok: true,
      value: { lat: 1, lng: 2, address: 'a'.repeat(MAX_ADDRESS_LENGTH) },
    });
  });
});

describe('valet fix freshness (§21.3 #9)', () => {
  const at = 1_000_000;
  const fix = { lat: 1, lng: 2, at };

  it('is live within 30s and stale after', () => {
    expect(fixFreshness(null, at)).toEqual({ kind: 'none' });
    expect(fixFreshness(fix, at + STALE_FIX_MS)).toEqual({ kind: 'live' });
    expect(fixFreshness(fix, at + STALE_FIX_MS + 1_000)).toEqual({ kind: 'stale', secondsAgo: 31 });
  });

  it('words the age in seconds, then minutes', () => {
    expect(staleFixLabel(45)).toBe('Last seen 45s ago');
    expect(staleFixLabel(185)).toBe('Last seen 3 min ago');
  });

  it('keeps the newer of the socket and polled fixes', () => {
    const older = { ...fix, at: at - 5 };
    expect(newerFix(fix, older)).toBe(fix);
    expect(newerFix(older, fix)).toBe(fix);
    expect(newerFix(null, fix)).toBe(fix);
    expect(newerFix(fix, null)).toBe(fix);
  });
});
