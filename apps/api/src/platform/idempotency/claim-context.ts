import { AsyncLocalStorage } from 'node:async_hooks';

import { ConflictException } from '@nestjs/common';
import type { Transaction } from '@parkease/db';
import { idempotencyKeys } from '@parkease/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * The idempotency claim the current request holds, set by `IdempotencyInterceptor` (and the
 * webhook path) around the handler. Nest binds `next.handle()` with `AsyncResource.bind`, so a
 * store entered around that call is the store the controller and every command it calls see.
 */
export interface IdempotencyClaim {
  readonly key: string;
  /** The claim token: `locked_at` as this attempt wrote it. */
  readonly claimedAt: Date;
}

export const idempotencyClaim = new AsyncLocalStorage<IdempotencyClaim>();

/**
 * A taken-over attempt reached its commit. The same code as an in-flight claim on purpose: the
 * client's right move is the same, keep the key and retry, which replays the newer attempt's
 * answer once it lands.
 */
export class ClaimSupersededError extends ConflictException {
  constructor() {
    super({
      error: 'REQUEST_IN_FLIGHT',
      message: 'A newer attempt of this request is being processed. Give it a moment.',
    });
  }
}

/**
 * The last statement of every domain transaction that runs under a claim (S-64).
 *
 * A transaction that wrote anything marks its claim committed, in the same transaction, and only
 * while that claim still holds the key. If a retry took the key over because this attempt ran past
 * `IDEMPOTENCY_IN_FLIGHT_STALE_MS`, the update matches nothing and the throw rolls the whole write
 * back, so a slow attempt can never land beside the retry that replaced it. And because the mark
 * commits with the write, a write whose response is later lost is never taken over and run again.
 *
 * A read-only transaction has no transaction id yet (`pg_current_xact_id_if_assigned()` is NULL),
 * so it neither marks nor fences: it has no side effect to repeat.
 */
export async function fenceOnClaim(tx: Transaction): Promise<void> {
  const claim = idempotencyClaim.getStore();
  if (claim === undefined) return;

  const [probe] = await tx.execute<{ wrote: boolean }>(
    sql`SELECT pg_current_xact_id_if_assigned() IS NOT NULL AS wrote`,
  );
  if (probe?.wrote !== true) return;

  const held = await tx
    .update(idempotencyKeys)
    .set({ committedAt: sql`coalesce(${idempotencyKeys.committedAt}, now())` })
    .where(and(eq(idempotencyKeys.key, claim.key), eq(idempotencyKeys.lockedAt, claim.claimedAt)))
    .returning({ key: idempotencyKeys.key });

  if (held.length === 0) throw new ClaimSupersededError();
}
