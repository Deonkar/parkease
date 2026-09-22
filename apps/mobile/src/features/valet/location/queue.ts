import { z } from 'zod';

import { warn } from '@/lib/log';

/**
 * The offline buffer for position fixes.
 *
 * The OS delivers fixes into a headless context where the socket may not be
 * connected, so the task callback enqueues and never sends: a fire-and-forget
 * emit from there loses fixes silently, which is the one failure this whole
 * feature exists to make impossible.
 */

/** Roughly 15 minutes at the configured interval. */
export const MAX_QUEUED_FIXES = 200;

const locationFixSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  headingDeg: z.number().nullable(),
  accuracyM: z.number().nullable(),
  recordedAt: z.number(),
});

export type LocationFix = z.infer<typeof locationFixSchema>;

/**
 * Why a fix could not be sent.
 *
 * `offline` is worth another attempt; `rejected` never is — a FORBIDDEN for a
 * job this valet is not assigned to will be FORBIDDEN forever, and retrying it
 * blocks every good fix behind it.
 */
export type SendFailure = 'offline' | 'rejected';
export type SendResult = { ok: true } | { ok: false; reason: SendFailure };

/** The persistence seam, so the queue's behaviour is testable without a device. */
export interface FixStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface LocationQueueOptions {
  readonly store: FixStore;
  readonly send: (fix: LocationFix) => Promise<SendResult>;
  readonly maxFixes?: number;
}

export interface LocationQueue {
  enqueue(fix: LocationFix): Promise<void>;
  drain(): Promise<void>;
  pending(): Promise<LocationFix[]>;
}

export function createLocationQueue({
  store,
  send,
  maxFixes = MAX_QUEUED_FIXES,
}: LocationQueueOptions): LocationQueue {
  /**
   * R-VAL-01: a cached value is data from outside this process. A corrupt blob
   * yields an empty queue rather than throwing inside a headless OS callback,
   * where nothing would catch it; a single malformed entry is dropped without
   * taking the good fixes beside it.
   */
  async function read(): Promise<LocationFix[]> {
    const raw = await store.read();
    if (raw === null) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const fixes: LocationFix[] = [];
    for (const entry of parsed) {
      const result = locationFixSchema.safeParse(entry);
      if (result.success) fixes.push(result.data);
    }
    return fixes;
  }

  async function write(fixes: readonly LocationFix[]): Promise<void> {
    await store.write(JSON.stringify(fixes));
  }

  /** Oldest first, so a drain replays the route in the order it was travelled. */
  function ordered(fixes: readonly LocationFix[]): LocationFix[] {
    return [...fixes].sort((a, b) => a.recordedAt - b.recordedAt);
  }

  /**
   * One drain at a time.
   *
   * Every captured fix attempts a send, and the OS can deliver fixes faster
   * than a request completes. Without this, two drains read the same backlog
   * and send it twice, then race to write what is left.
   */
  let draining = false;

  const queue: LocationQueue = {
    async enqueue(fix) {
      const queued = ordered([...(await read()), fix]).slice(-maxFixes);
      await write(queued);

      // Send immediately. Enqueue-and-wait was the original shape, and it meant
      // nothing reached the server between going online and going offline —
      // `last_seen_at` went stale within a minute and the driver's map never
      // moved. The buffer is for when a send FAILS, not a substitute for trying.
      if (draining) return;
      draining = true;
      try {
        await queue.drain();
      } finally {
        draining = false;
      }
    },

    async drain() {
      const queued = ordered(await read());
      let index = 0;

      for (; index < queued.length; index += 1) {
        const fix = queued[index];
        if (fix === undefined) break;

        // `send` is an injected contract, so a throw is possible even though
        // today's implementation returns a typed failure. Left unguarded, a
        // throw would skip the trailing write and re-send fixes already
        // delivered on the next drain.
        let result: SendResult;
        try {
          result = await send(fix);
        } catch (error) {
          warn('valet.queue: send threw; treating the fix as undelivered', error);
          result = { ok: false, reason: 'offline' };
        }

        if (result.ok) continue;
        // A refused fix is consumed; an unsendable one halts the drain so the
        // rest keep their order for the next attempt.
        if (result.reason === 'rejected') continue;
        break;
      }

      await write(queued.slice(index));
    },

    async pending() {
      return ordered(await read());
    },
  };

  return queue;
}
