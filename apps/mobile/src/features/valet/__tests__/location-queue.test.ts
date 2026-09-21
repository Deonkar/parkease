import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_QUEUED_FIXES,
  createLocationQueue,
  type FixStore,
  type LocationFix,
} from '../location/queue';

function memoryStore(): FixStore & { raw: () => string | null } {
  let value: string | null = null;
  return {
    read: () => Promise.resolve(value),
    write: (next) => {
      value = next;
      return Promise.resolve();
    },
    raw: () => value,
  };
}

const fix = (recordedAt: number): LocationFix => ({
  lat: 12.9361,
  lng: 77.6229,
  headingDeg: 214,
  accuracyM: 8,
  recordedAt,
});

describe('location queue', () => {
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
  });

  it('holds a fix that could not be sent', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'offline' as const }));
    const queue = createLocationQueue({ store, send });

    await queue.enqueue(fix(1_000));

    expect(await queue.pending()).toHaveLength(1);
  });

  it('drains in timestamp order, oldest first', async () => {
    const sent: number[] = [];
    const send = vi.fn((f: LocationFix) => {
      sent.push(f.recordedAt);
      return Promise.resolve({ ok: true as const });
    });
    const queue = createLocationQueue({ store, send });

    // Enqueued out of order, as a late-arriving fix would be.
    await queue.enqueue(fix(3_000));
    await queue.enqueue(fix(1_000));
    await queue.enqueue(fix(2_000));
    await queue.drain();

    expect(sent).toEqual([1_000, 2_000, 3_000]);
    expect(await queue.pending()).toHaveLength(0);
  });

  it('drops the oldest fixes past the bound and always keeps the newest', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'offline' as const }));
    const queue = createLocationQueue({ store, send });

    for (let i = 0; i < MAX_QUEUED_FIXES + 25; i += 1) {
      await queue.enqueue(fix(i));
    }

    const pending = await queue.pending();
    expect(pending).toHaveLength(MAX_QUEUED_FIXES);
    // Position is perishable: the newest fix is the one that must survive.
    expect(pending.at(-1)?.recordedAt).toBe(MAX_QUEUED_FIXES + 24);
    expect(pending.at(0)?.recordedAt).toBe(25);
  });

  it('keeps a fix the server could not take, so a drop is never silent', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'offline' as const }));
    const queue = createLocationQueue({ store, send });

    await queue.enqueue(fix(1_000));
    await queue.drain();

    expect(await queue.pending()).toHaveLength(1);
  });

  it('discards a fix the server refused rather than retrying it forever', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: false as const, reason: 'rejected' as const }));
    const queue = createLocationQueue({ store, send });

    await queue.enqueue(fix(1_000));
    await queue.drain();

    // FORBIDDEN for a job this valet is not on will never succeed on a retry.
    expect(await queue.pending()).toHaveLength(0);
  });

  it('stops draining at the first unsendable fix, preserving order', async () => {
    const sent: number[] = [];
    const send = vi.fn((f: LocationFix) => {
      if (f.recordedAt === 2_000) {
        return Promise.resolve({ ok: false as const, reason: 'offline' as const });
      }
      sent.push(f.recordedAt);
      return Promise.resolve({ ok: true as const });
    });
    const queue = createLocationQueue({ store, send });

    await queue.enqueue(fix(1_000));
    await queue.enqueue(fix(2_000));
    await queue.enqueue(fix(3_000));
    await queue.drain();

    expect(sent).toEqual([1_000]);
    expect((await queue.pending()).map((f) => f.recordedAt)).toEqual([2_000, 3_000]);
  });

  it('recovers from a corrupt stored value instead of crashing the task', async () => {
    // R-VAL-01: a cached value is outside data and parses through the schema.
    await store.write('{"not":"an array of fixes"}');
    const send = vi.fn(() => Promise.resolve({ ok: true as const }));
    const queue = createLocationQueue({ store, send });

    await expect(queue.pending()).resolves.toEqual([]);

    await queue.enqueue(fix(1_000));
    expect(await queue.pending()).toHaveLength(1);
  });

  it('drops a single malformed fix without discarding the good ones beside it', async () => {
    await store.write(JSON.stringify([fix(1_000), { lat: 'not a number', lng: 1 }, fix(2_000)]));
    const send = vi.fn(() => Promise.resolve({ ok: true as const }));
    const queue = createLocationQueue({ store, send });

    expect((await queue.pending()).map((f) => f.recordedAt)).toEqual([1_000, 2_000]);
  });
});
