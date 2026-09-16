/**
 * A Redis command recorder.
 *
 * The surge job's contract with Redis is "one MULTI for N zones, each key with
 * a 600 second TTL" — a statement about the commands issued, not about what a
 * server stores. Counting them on a double is the only way to assert it, and it
 * is what keeps the N+1 guard honest.
 */
export interface RecordedSet {
  readonly key: string;
  readonly value: string;
  readonly mode: string;
  readonly ttl: number;
}

export interface FakeRedis {
  readonly client: { multi: () => unknown };
  readonly sets: RecordedSet[];
  readonly counts: { multi: number; exec: number };
}

export function fakeRedis(opts: { execReturnsNull?: boolean } = {}): FakeRedis {
  const sets: RecordedSet[] = [];
  const counts = { multi: 0, exec: 0 };

  const pipeline = {
    set(key: string, value: string, mode: 'EX', ttl: number) {
      sets.push({ key, value, mode, ttl });
      return pipeline;
    },
    exec(): Promise<[Error | null, unknown][] | null> {
      counts.exec += 1;
      if (opts.execReturnsNull === true) return Promise.resolve(null);
      return Promise.resolve(sets.map(() => [null, 'OK'] as [Error | null, unknown]));
    },
  };

  return {
    client: {
      multi() {
        counts.multi += 1;
        return pipeline;
      },
    },
    sets,
    counts,
  };
}
