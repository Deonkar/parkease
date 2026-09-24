import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../shared/__tests__/render-native';
import { useWasherPresence, type WasherPresence } from '../hooks/useWasherPresence';

/**
 * I6: `goOffline` pressed while `goOnline` is still on its way must END
 * offline. Before, `goOffline` saw no handle yet and returned at once; the
 * start then finished and left the partner online, with the switch reading
 * whatever it last said.
 */

const m = vi.hoisted(() => ({
  sent: [] as boolean[],
  releaseOnline: null as (() => void) | null,
}));

vi.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'granted' }),
  getForegroundPermissionsAsync: () => Promise.resolve({ status: 'granted' }),
  getCurrentPositionAsync: () => Promise.resolve({ coords: { latitude: 12.93, longitude: 77.61 } }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../hooks/useWasherQueries', () => ({
  useWasherProfile: () => ({ data: undefined }),
  washerKeys: { profile: ['washer', 'profile'] },
}));

vi.mock('../api/washer', () => ({
  setAvailability: (isOnline: boolean) => {
    m.sent.push(isOnline);
    if (!isOnline) return Promise.resolve();
    // The going-online PATCH waits until the test lets it land.
    return new Promise<void>((resolve) => {
      m.releaseOnline = resolve;
    });
  },
}));

vi.mock('../dev-mock', () => ({ isWasherDevMock: () => Promise.resolve(false) }));
vi.mock('../api/dev-fixtures', () => ({ DEV_WASHER_FIX: { lat: 0, lng: 0 } }));
vi.mock('@/lib/api', () => ({ newIntent: () => ({ idempotencyKey: 'k' }) }));
vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

let presence: WasherPresence;

function Harness() {
  presence = useWasherPresence();
  return null;
}

beforeEach(() => {
  m.sent = [];
  m.releaseOnline = null;
  render(<Harness />);
});

describe('going offline while going online is still in flight', () => {
  it('ends offline, with the offline PATCH the last thing the server hears', async () => {
    let online: Promise<unknown> = Promise.resolve();
    let offline: Promise<unknown> = Promise.resolve();

    await act(async () => {
      online = presence.goOnline();
      // Let the permission and GPS answer, so the online PATCH is on the wire.
      await vi.waitFor(() => {
        expect(m.releaseOnline).not.toBeNull();
      });
      offline = presence.goOffline();
    });

    await act(async () => {
      m.releaseOnline?.();
      await online;
      await offline;
    });

    expect(presence.isOnline).toBe(false);
    expect(m.sent).toEqual([true, false]);
  });
});
