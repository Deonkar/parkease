import { WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS } from '@parkease/contracts/washer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEARTBEAT_INTERVAL_MS,
  LOCATE_TIMEOUT_MS,
  startPresence,
  type BeatResult,
  type Fix,
  type LocateOutcome,
  type PresenceDeps,
} from '../presence';

vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

const FIRST: Fix = { lat: 12.9345, lng: 77.6101 };
const SECOND: Fix = { lat: 12.9351, lng: 77.6112 };
const THIRD: Fix = { lat: 12.9362, lng: 77.6125 };

interface Sent {
  readonly isOnline: boolean;
  readonly fix: Fix | undefined;
}

interface Harness {
  readonly deps: PresenceDeps;
  readonly sent: Sent[];
  readonly beats: BeatResult[];
}

/**
 * A partner walking between bays: each `locate()` answers the next scripted
 * outcome, so a test can tell a fresh fix from a replayed one.
 */
function harness(
  outcomes: readonly LocateOutcome[],
  send: (isOnline: boolean, fix?: Fix) => Promise<void> = () => Promise.resolve(),
): Harness {
  const sent: Sent[] = [];
  const beats: BeatResult[] = [];
  let index = 0;

  return {
    sent,
    beats,
    deps: {
      locate: () => {
        const next = outcomes[Math.min(index, outcomes.length - 1)];
        index += 1;
        if (next === undefined) return Promise.reject(new Error('no fix scripted'));
        return Promise.resolve(next);
      },
      send: (isOnline, fix) => {
        sent.push({ isOnline, fix });
        return send(isOnline, fix);
      },
      onBeat: (result) => {
        beats.push(result);
      },
    },
  };
}

const at = (fix: Fix): LocateOutcome => ({ ok: true, fix });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the heartbeat interval', () => {
  it('is half the server window, derived rather than written down', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe((WASH_ONLINE_HEARTBEAT_WINDOW_SECONDS * 1000) / 2);
  });
});

describe('startPresence', () => {
  it('goes online with exactly one PATCH, and it carries a location', async () => {
    const h = harness([at(FIRST)]);

    const started = await startPresence(h.deps);

    expect(started.ok).toBe(true);
    expect(h.sent).toEqual([{ isOnline: true, fix: FIRST }]);
  });

  it('beats again after one interval, with a FRESH fix', async () => {
    const h = harness([at(FIRST), at(SECOND), at(THIRD)]);
    await startPresence(h.deps);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS - 1);
    expect(h.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.sent).toEqual([
      { isOnline: true, fix: FIRST },
      { isOnline: true, fix: SECOND },
    ]);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.sent[2]).toEqual({ isOnline: true, fix: THIRD });
    expect(h.beats).toEqual([{ ok: true }, { ok: true }]);
  });

  it('stop sends isOnline false, and no beat follows it', async () => {
    const h = harness([at(FIRST), at(SECOND)]);
    const started = await startPresence(h.deps);
    if (!started.ok) throw new Error('expected to start');

    await expect(started.handle.stop()).resolves.toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 4);

    expect(h.sent).toEqual([
      { isOnline: true, fix: FIRST },
      { isOnline: false, fix: undefined },
    ]);
  });

  it('a failed beat does not stop the next one', async () => {
    const down = new Error('network down');
    let calls = 0;
    const h = harness([at(FIRST), at(SECOND), at(THIRD)], () => {
      calls += 1;
      // The PATCH that goes online lands; the first HEARTBEAT is lost.
      return calls === 2 ? Promise.reject(down) : Promise.resolve();
    });
    await startPresence(h.deps);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.beats).toEqual([{ ok: false, reason: 'unreachable', cause: down }]);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.sent[2]).toEqual({ isOnline: true, fix: THIRD });
    // Recovered, so the rail can clear "Reconnecting…".
    expect(h.beats[1]).toEqual({ ok: true });
  });

  it('a beat with no fix is reported, sends nothing, and does not stop the next one', async () => {
    const h = harness([at(FIRST), { ok: false, reason: 'permission_denied' }, at(THIRD)]);
    await startPresence(h.deps);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.beats).toEqual([{ ok: false, reason: 'permission_denied' }]);
    // Nothing was sent without a location: the contract refuses online-without-a-fix.
    expect(h.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.sent[1]).toEqual({ isOnline: true, fix: THIRD });
  });

  it('does not go online, or beat, when there is no fix to send', async () => {
    const h = harness([{ ok: false, reason: 'permission_denied' }]);

    const started = await startPresence(h.deps);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);

    expect(started).toEqual({ ok: false, reason: 'permission_denied' });
    expect(h.sent).toEqual([]);
  });

  it('does not beat when going online was refused, and hands back why', async () => {
    const refusal = new Error('403');
    const h = harness([at(FIRST), at(SECOND)], () => Promise.reject(refusal));

    const started = await startPresence(h.deps);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);

    expect(started).toEqual({ ok: false, reason: 'unreachable', cause: refusal });
    expect(h.sent).toHaveLength(1);
  });

  it('a GPS that throws is a typed failure, not a rejection', async () => {
    const h = harness([at(FIRST)]);
    const deps: PresenceDeps = {
      ...h.deps,
      locate: () => Promise.reject(new Error('location unavailable')),
    };

    await expect(startPresence(deps)).resolves.toEqual({
      ok: false,
      reason: 'location_failed',
    });
    expect(h.sent).toEqual([]);
  });

  it('an offline PATCH that fails is reported, and the heartbeat still stops', async () => {
    const down = new Error('network down');
    let calls = 0;
    const h = harness([at(FIRST), at(SECOND)], () => {
      calls += 1;
      return calls === 2 ? Promise.reject(down) : Promise.resolve();
    });
    const started = await startPresence(h.deps);
    if (!started.ok) throw new Error('expected to start');

    const stopped = await started.handle.stop();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);

    expect(stopped).toEqual({ ok: false, reason: 'unreachable', cause: down });
    expect(h.sent).toHaveLength(2);
  });

  it('a stop while a beat waits on the GPS makes offline the LAST thing the server hears', async () => {
    // The race: a beat is waiting on GPS when the partner flips the switch. If
    // its late `isOnline: true` landed after the `false`, the server would put
    // them straight back into the pool they just left.
    let releaseLocate: (outcome: LocateOutcome) => void = () => undefined;
    let locates = 0;
    const h = harness([at(FIRST)]);
    const deps: PresenceDeps = {
      ...h.deps,
      locate: () => {
        locates += 1;
        if (locates === 1) return Promise.resolve(at(FIRST));
        return new Promise<LocateOutcome>((resolve) => {
          releaseLocate = resolve;
        });
      },
    };
    const started = await startPresence(deps);
    if (!started.ok) throw new Error('expected to start');

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    const stopping = started.handle.stop();
    await stopping;
    // The GPS answers only AFTER offline went out — let that late beat finish.
    releaseLocate(at(SECOND));
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    expect(h.sent.at(-1)).toEqual({ isOnline: false, fix: undefined });
    expect(h.sent.filter((s) => s.isOnline)).toHaveLength(1);
  });

  it('halt stops beating without telling the server', async () => {
    const h = harness([at(FIRST), at(SECOND)]);
    const started = await startPresence(h.deps);
    if (!started.ok) throw new Error('expected to start');

    started.handle.halt();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);

    expect(h.sent).toEqual([{ isOnline: true, fix: FIRST }]);
  });
});

/** A GPS that never answers — a basement car park, which is where washers work. */
const never = () => new Promise<LocateOutcome>(() => undefined);

describe('a GPS that never answers', () => {
  it('bounds the wait by a timeout derived from the interval, not a literal', () => {
    expect(LOCATE_TIMEOUT_MS).toBe(HEARTBEAT_INTERVAL_MS / 3);
  });

  it('fails going online after the timeout instead of leaving the switch busy', async () => {
    const h = harness([at(FIRST)]);
    const pending = startPresence({ ...h.deps, locate: never });

    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'location_failed' });
    expect(h.sent).toEqual([]);
  });

  it('reports a location_failed beat, and the NEXT beat is still scheduled', async () => {
    let locates = 0;
    const h = harness([at(FIRST)]);
    const deps: PresenceDeps = {
      ...h.deps,
      locate: () => {
        locates += 1;
        if (locates === 2) return never();
        return Promise.resolve(at(locates === 1 ? FIRST : THIRD));
      },
    };
    await startPresence(deps);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + LOCATE_TIMEOUT_MS);
    // Not silence: the rail can say the location is not updating.
    expect(h.beats).toEqual([{ ok: false, reason: 'location_failed' }]);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(locates).toBe(3);
    expect(h.sent.at(-1)).toEqual({ isOnline: true, fix: THIRD });
  });

  it('stop() resolves while a beat is stuck on the GPS, and nothing follows offline', async () => {
    let locates = 0;
    const h = harness([at(FIRST)]);
    const deps: PresenceDeps = {
      ...h.deps,
      locate: () => {
        locates += 1;
        return locates === 1 ? Promise.resolve(at(FIRST)) : never();
      },
    };
    const started = await startPresence(deps);
    if (!started.ok) throw new Error('expected to start');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    const stopping = started.handle.stop();
    await vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS * 2);

    await expect(stopping).resolves.toEqual({ ok: true });
    expect(h.sent.at(-1)).toEqual({ isOnline: false, fix: undefined });
  });
});

describe('ordering against a PATCH already on the wire', () => {
  it('holds the offline PATCH until an in-flight online PATCH has landed', async () => {
    // The late half of the race: the beat already has its fix and its
    // `isOnline: true` is on the network when the partner switches off. Sent
    // concurrently, the true could land second and put them back in the pool.
    let releaseSend: () => void = () => undefined;
    let sends = 0;
    const h = harness([at(FIRST), at(SECOND)], () => {
      sends += 1;
      if (sends !== 2) return Promise.resolve();
      return new Promise<void>((resolve) => {
        releaseSend = resolve;
      });
    });
    const started = await startPresence(h.deps);
    if (!started.ok) throw new Error('expected to start');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    expect(h.sent).toHaveLength(2);

    const stopping = started.handle.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toHaveLength(2);

    releaseSend();
    await stopping;
    expect(h.sent.map((s) => s.isOnline)).toEqual([true, true, false]);
  });
});

describe('the cadence', () => {
  it('measures the next beat from when the last one STARTED, so a slow beat costs no gap', async () => {
    // A beat that takes most of an interval. Timed from when it settled, the
    // next beat would start a whole interval later, and one lost beat after it
    // would push the gap between landed PATCHes past the server's window.
    const slow = HEARTBEAT_INTERVAL_MS - 5_000;
    let locates = 0;
    let sends = 0;
    const h = harness([at(FIRST)], () => {
      sends += 1;
      return sends === 2
        ? new Promise<void>((resolve) => setTimeout(resolve, slow))
        : Promise.resolve();
    });
    const deps: PresenceDeps = {
      ...h.deps,
      locate: () => {
        locates += 1;
        return Promise.resolve(at(SECOND));
      },
    };
    await startPresence(deps);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2 - 1);
    expect(locates).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(locates).toBe(3);
  });
});
