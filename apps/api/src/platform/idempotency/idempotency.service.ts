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
 * too long and a stuck key blocks its user for that long. Only a claim that
 * still has no stored response is ever taken over, so a finished attempt's
 * replay is never lost.
 */
export const IDEMPOTENCY_IN_FLIGHT_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async claim(input: ClaimInput): Promise<ClaimOutcome> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);

    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({
        key: input.key,
        userId: input.userId,
        endpoint: input.endpoint,
        requestHash: input.requestHash,
        lockedAt: new Date(),
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

    return (await this.takeOverIfStale(input.key))
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
   */
  private async takeOverIfStale(key: string): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - IDEMPOTENCY_IN_FLIGHT_STALE_MS);

    const taken = await this.db
      .update(idempotencyKeys)
      .set({ lockedAt: now, updatedAt: now })
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

  async store(key: string, status: number, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({
        responseStatus: status,
        responseBody: body as Record<string, unknown>,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeys.key, key));
  }

  async release(key: string): Promise<void> {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  }

  async prune(): Promise<number> {
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(sql`${idempotencyKeys.expiresAt} < now()`)
      .returning({ key: idempotencyKeys.key });
    return deleted.length;
  }
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
