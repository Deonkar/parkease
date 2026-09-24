import type { UpsertWashService } from '@parkease/contracts/washer';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { render } from '../../shared/__tests__/render-native';
import { useServiceSave, type ServiceSave } from '../hooks/useServiceSave';

/**
 * R-FE-05 for the menu: one intent per save the partner starts, replayed when
 * that same save is retried after a transport failure, and minted fresh after
 * the server has answered for good. The server's idempotency interceptor
 * refuses a reused key with a different body (422), so a changed row is a new
 * save and must carry a new key.
 */

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), warn: vi.fn(), minted: 0 }));

vi.mock('@/lib/api', () => ({
  newIntent: () => {
    mocks.minted += 1;
    return { idempotencyKey: `intent-${String(mocks.minted)}` };
  },
}));

vi.mock('@/lib/log', () => ({ warn: mocks.warn }));

vi.mock('../hooks/useWasherQueries', () => ({
  useUpsertService: () => ({ mutateAsync: mocks.mutateAsync }),
}));

let saver: ServiceSave;

function Harness() {
  saver = useServiceSave();
  return null;
}

const INPUT = {
  carPricePaise: 44900,
  bikePricePaise: 17900,
  durationMinutes: 40,
  isActive: true,
} as UpsertWashService;

const OFFLINE = new Error('Network Error');
const REFUSED = {
  response: {
    status: 400,
    data: { error: { code: 'VALIDATION_FAILED', message: 'Invalid request body', traceId: 't' } },
  },
};

const intentOf = (call: number) =>
  (mocks.mutateAsync.mock.calls[call]?.[0] as { intent: { idempotencyKey: string } } | undefined)
    ?.intent.idempotencyKey;

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.warn.mockReset();
  mocks.minted = 0;
  render(<Harness />);
});

describe('the intent behind a menu save', () => {
  it('replays the same intent when the same save is retried after a transport failure', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    await act(() => saver.save('premium_wash', INPUT));

    expect(intentOf(0)).toBe('intent-1');
    expect(intentOf(1)).toBe('intent-1');
  });

  it('mints a new intent once a save succeeded', async () => {
    mocks.mutateAsync.mockResolvedValue({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    await act(() => saver.save('premium_wash', INPUT));

    expect(intentOf(1)).not.toBe(intentOf(0));
  });

  it('mints a new intent after a definite refusal', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(REFUSED).mockResolvedValueOnce({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    await act(() => saver.save('premium_wash', INPUT));

    expect(intentOf(1)).not.toBe(intentOf(0));
  });

  it('mints a new intent when the partner changed the row before retrying', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(OFFLINE).mockResolvedValueOnce({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    await act(() => saver.save('premium_wash', { ...INPUT, durationMinutes: 45 }));

    expect(intentOf(1)).not.toBe(intentOf(0));
  });

  it('keeps each service on its own intent', async () => {
    mocks.mutateAsync.mockRejectedValue(OFFLINE);

    await act(() => saver.save('premium_wash', INPUT));
    await act(() => saver.save('quick_wipe', INPUT));

    expect(intentOf(1)).not.toBe(intentOf(0));
  });
});

describe('what a failed save leaves on screen', () => {
  it('says a transport failure under that row, logs it, and says nothing under the others', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(OFFLINE);

    await act(() => saver.save('premium_wash', INPUT));

    expect(saver.failureFor('premium_wash')).toMatch(/connection/i);
    expect(saver.failureFor('quick_wipe')).toBeNull();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it('says a refusal differently from a dead connection', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(REFUSED);

    await act(() => saver.save('premium_wash', INPUT));

    expect(saver.failureFor('premium_wash')).not.toMatch(/connection/i);
  });

  it('clears the failure once the retry succeeds, and is pending only while in flight', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(OFFLINE);
    await act(() => saver.save('premium_wash', INPUT));

    let settle: (value: unknown) => void = () => undefined;
    mocks.mutateAsync.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    let inFlight: Promise<void> = Promise.resolve();
    act(() => {
      inFlight = saver.save('premium_wash', INPUT);
    });
    expect(saver.isSaving('premium_wash')).toBe(true);
    expect(saver.isSaving('quick_wipe')).toBe(false);

    await act(async () => {
      settle({ services: [] });
      await inFlight;
    });
    expect(saver.isSaving('premium_wash')).toBe(false);
    expect(saver.failureFor('premium_wash')).toBeNull();
  });
});

/** G1: the two classes that mean the same thing everywhere are said truthfully. */
describe('an out-of-date app and a save still in flight', () => {
  const OUTDATED = new ZodError([]);
  const IN_FLIGHT = {
    response: { status: 409, data: { error: { code: 'REQUEST_IN_FLIGHT', message: 'm' } } },
  };

  it('says "Update the app" for a 2xx this build could not read, and drops the intent', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(OUTDATED).mockResolvedValueOnce({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    expect(saver.failureFor('premium_wash')).toMatch(/Update the app to continue/);
    expect(saver.failureFor('premium_wash')).not.toMatch(/connection/i);

    await act(() => saver.save('premium_wash', INPUT));
    expect(intentOf(1)).not.toBe(intentOf(0));
  });

  it('says the first attempt is still being processed, and keeps the intent', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(IN_FLIGHT).mockResolvedValueOnce({ services: [] });

    await act(() => saver.save('premium_wash', INPUT));
    expect(saver.failureFor('premium_wash')).toMatch(/still being processed/);
    expect(saver.failureFor('premium_wash')).not.toMatch(/connection/i);

    await act(() => saver.save('premium_wash', INPUT));
    expect(intentOf(1)).toBe(intentOf(0));
  });
});
