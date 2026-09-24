import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { idempotencyKeys } from '@parkease/db/schema';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module.js';

type ClaimOutcome =
  | { readonly outcome: 'proceed' }
  | { readonly outcome: 'replay'; readonly response: unknown; readonly status: number }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'in_flight' };

interface ClaimInput {
  readonly key: string;
  /**
   * `null` where there genuinely is no user: a Razorpay webhook (ADR-011
   * deduplicates those on the event id in this table) or an /auth route that is
   * still creating the session. Anywhere else the database refuses it —
   * `idempotency_keys_user_or_public_check`.
   */
  readonly userId: string | null;
  readonly endpoint: string;
  readonly requestHash: string;
  /**
   * This attempt's claim token. A claim that proceeds — fresh or taken over —
   * writes it to `locked_at`, and `store` and `release` pass it back so their
   * write lands only on the claim it came from, never on one a newer retry has
   * taken over since. Minted by the caller rather than returned, so `proceed`
   * keeps its shape for every existing caller. Defaults to now; a test ages a
   * claim by passing an older one.
   */
  readonly claimedAt?: Date;
}

const EXPIRY_HOURS = 24;

/**
 * How old an unfinished claim must be before a retry may take it over.
 *
 * A claim is `in_flight` from the moment it is taken until `store` writes the
 * response or `release` deletes the key. If either write fails, nothing else
 * ever finishes it, and REQUEST_IN_FLIGHT — which tells the client to keep its
 * key and retry — would answer every retry for the key's whole 24 hours
 * (silent failure H1, task 14 final fix wave).
 *
 * Five minutes is longer than any handler here should run: every write path is
 * one short transaction plus, at most, one gateway call, and a mobile client
 * gives up on a request long before this. It is a judgement, not a derived
 * bound — no request, statement or gateway timeout in this API caps a handler
 * yet (suggestedtask.md S-64). Too short and a slow live attempt runs twice;
 * too long and a stuck key blocks its user for that long.
 *
 * A takeover RE-RUNS THE HANDLER, and there are two ways that runs a side
 * effect twice. A live attempt slower than the threshold is one. The other is
 * an attempt that committed its domain write and then failed to `store` the
 * response: the key is left with no response to replay, so the retry that
 * takes it over runs the write again — a second payment order, a second
 * booking. Before the takeover existed the same failure blocked the key for
 * 24 hours instead, which was safe but stuck. What keeps this rare, not
 * impossible: the interceptor retries a failed `store` once, so only two
 * consecutive failures leave a committed write unstored, and both are logged
 * at warn with the key and trace id. What keeps it from compounding: `store`
 * and `release` are conditioned on the claim that made them, so a zombie
 * attempt can neither store its answer over a newer retry's claim nor delete
 * it and let a third attempt in. Only storing the response inside the
 * handler's own transaction closes it for good (S-64).
 */
export const IDEMPOTENCY_IN_FLIGHT_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async claim(input: ClaimInput): Promise<ClaimOutcome> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
    const claimedAt = input.claimedAt ?? new Date();

    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({
        key: input.key,
        userId: input.userId,
        endpoint: input.endpoint,
        requestHash: input.requestHash,
        lockedAt: claimedAt,
        expiresAt,
      })
      .onConflictDoNothing({ target: idempotencyKeys.key })
      .returning({ key: idempotencyKeys.key });

    if (inserted.length > 0) {
      return { outcome: 'proceed' };
    }

    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, input.key));

    const existing = rows[0];
    if (!existing) return { outcome: 'proceed' };

    if (existing.userId !== input.userId) {
      return { outcome: 'conflict' };
    }

    // ADR-011 stores the endpoint alongside the key; comparing only the user and
    // the body wastes it. Without this, one key reused across two routes with
    // the same body replays the first route's response onto the second — a
    // cancel's answer returned for an extend, and the extend never running.
    if (existing.endpoint !== input.endpoint) {
      return { outcome: 'conflict' };
    }

    if (existing.requestHash !== input.requestHash) {
      return { outcome: 'conflict' };
    }

    if (existing.responseBody !== null && existing.responseStatus !== null) {
      return {
        outcome: 'replay',
        response: existing.responseBody,
        status: existing.responseStatus,
      };
    }

    return (await this.takeOverIfStale(input.key, claimedAt))
      ? { outcome: 'proceed' }
      : { outcome: 'in_flight' };
  }

  /**
   * Re-locks an unfinished claim for this retry if it has been in flight for
   * longer than `IDEMPOTENCY_IN_FLIGHT_STALE_MS`.
   *
   * One conditional UPDATE, so two retries racing for the same stale key cannot
   * both win: the first moves `locked_at` to now, and the second's `locked_at <
   * staleBefore` no longer matches. `response_body IS NULL` means a claim that
   * finished between our read and this write is replayed, never re-run. A NULL
   * `locked_at` with no response is not a state any path writes, but it is not a
   * live attempt either, so it is taken over rather than left to block.
   *
   * The new `locked_at` is the retry's own claim token, which is what stops the
   * attempt it replaced from storing over it or releasing it (see `store`).
   */
  private async takeOverIfStale(key: string, claimedAt: Date): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - IDEMPOTENCY_IN_FLIGHT_STALE_MS);

    const taken = await this.db
      .update(idempotencyKeys)
      .set({ lockedAt: claimedAt, updatedAt: now })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          isNull(idempotencyKeys.responseBody),
          or(isNull(idempotencyKeys.lockedAt), lt(idempotencyKeys.lockedAt, staleBefore)),
        ),
      )
      .returning({ key: idempotencyKeys.key });

    return taken.length > 0;
  }

  /**
   * Saves the response for replay and finishes the claim.
   *
   * With `claimedAt`, the write lands only while the key is still held by that
   * claim, and resolves `false` when it is not — a newer retry took the key
   * over after this attempt went stale, and that retry's answer is the one to
   * keep. Without it the key alone decides; that is the webhook path, which
   * does not pass its claim yet (S-75).
   *
   * One edge: if a first attempt's UPDATE commits but its acknowledgement is
   * lost, a retry of this same store finds `locked_at` already cleared and
   * resolves `false` although the response is saved. The warning it causes is
   * a false alarm; nothing is lost or re-run.
   */
  async store(key: string, status: number, body: unknown, claimedAt?: Date): Promise<boolean> {
    const stored = await this.db
      .update(idempotencyKeys)
      .set({
        responseStatus: status,
        responseBody: body as Record<string, unknown>,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(heldBy(key, claimedAt))
      .returning({ key: idempotencyKeys.key });

    return stored.length > 0;
  }

  /**
   * Deletes the key so a retry can run again. Conditioned on `claimedAt` like
   * `store`, and for the same reason: a zombie that deleted a newer retry's
   * claim would let a third attempt claim the key fresh and run alongside it.
   */
  async release(key: string, claimedAt?: Date): Promise<boolean> {
    const released = await this.db
      .delete(idempotencyKeys)
      .where(heldBy(key, claimedAt))
      .returning({ key: idempotencyKeys.key });

    return released.length > 0;
  }

  async prune(): Promise<number> {
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(sql`${idempotencyKeys.expiresAt} < now()`)
      .returning({ key: idempotencyKeys.key });
    return deleted.length;
  }
}

/** The key, and — when the caller carries one — the claim that must still hold it. */
function heldBy(key: string, claimedAt: Date | undefined) {
  return claimedAt
    ? and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.lockedAt, claimedAt))
    : eq(idempotencyKeys.key, key);
}

export function hashCanonicalBody(body: unknown): string {
  const canonical = JSON.stringify(sortKeys(body));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}
