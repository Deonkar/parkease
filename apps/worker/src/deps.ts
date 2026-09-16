import type { Database } from '@parkease/db';
import { Redis } from 'ioredis';
import type PgBoss from 'pg-boss';

import { env } from './config/env.js';

/**
 * The slice of a Redis client the worker actually uses.
 *
 * It is declared structurally rather than as `Redis` so a test can hand the job
 * a command recorder without a server — which is how "one MULTI for N zones" is
 * asserted at all — and so the worker's dependency on ioredis stays one import
 * wide. `Redis` satisfies this; `tsc` checks that it still does at the call in
 * `main.ts`.
 */
export interface SurgeCachePipeline {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): SurgeCachePipeline;
  exec(): Promise<[Error | null, unknown][] | null>;
}

export interface SurgeCache {
  multi(): SurgeCachePipeline;
}

export interface JobDeps {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly redis: SurgeCache;
}

/**
 * Constructed on first call, not at import.
 *
 * ioredis connects eagerly on construction, and `env` exits the process on a
 * missing variable — so building this at module scope would mean that merely
 * importing a job, to hand it a test double, reaches for a server it is never
 * going to talk to and takes the whole test run down (learnings.md).
 */
const REDIS_MAX_RETRIES_PER_REQUEST = 3;

let client: Redis | undefined;

export function redisClient(): Redis {
  client ??= new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
  });
  return client;
}

/** Closes the connection if one was ever opened. Used by the shutdown path. */
export async function closeRedis(): Promise<void> {
  if (client === undefined) return;
  await client.quit();
  client = undefined;
}
