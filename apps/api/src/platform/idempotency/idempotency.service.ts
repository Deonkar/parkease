import { createHash, createHmac, hkdfSync } from 'node:crypto';

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { idempotencyKeys } from '@parkease/db/schema';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { env } from '../config/env.schema.js';
import { DB, type Database } from '../db/db.module.js';

type ClaimOutcome =
  | { readonly outcome: 'proceed' }
  | { readonly outcome: 'replay'; readonly response: unknown; readonly status: number }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'in_flight' }
  /**
   * The first attempt's write committed (`committed_at`, S-64) but no response was stored: it
   * failed after committing, or died before storing. Running the handler again would repeat the
   * write, so the caller is told it already happened instead.
   */
  | { readonly outcome: 'committed' };

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
   * The same request hashed the pre-S-101 way (plain SHA-256). A key stored before the switch to
   * HMAC holds that form, and a retry spanning the deploy must still match it rather than answer
   * 422 and push the client to a fresh key (and a second write). Every row written since holds the
   * HMAC, so this only ever matches a pre-switch row; it can go once no key older than the deploy
   * exists (`EXPIRY_HOURS`).
   */
  readonly legacyRequestHash?: string;
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
 * A claim is `in_flight` from the moment it is taken until `store` writes the response or
 * `release` finishes it. If either write fails, nothing else ever finishes it, and
 * REQUEST_IN_FLIGHT — which tells the client to keep its key and retry — would answer every retry
 * for the key's whole 24 hours (silent failure H1, task 14 final fix wave). So a claim this old
 * may be taken over, and a takeover RE-RUNS THE HANDLER.
 *
 * What makes that safe (S-64):
 *
 * - The commit fence. Every domain transaction under a claim ends with `fenceOnClaim`, which marks
 *   the claim `committed_at` in the same transaction and only while the claim still holds the key.
 *   An attempt slower than this threshold whose key was taken over cannot commit: its fence matches
 *   nothing and its write rolls back. A write that did commit is never taken over, whatever
 *   happened to its response: the retry is told it already went through (`committed`).
 * - The bounds, each well below this threshold, so a live attempt is not normally taken over at
 *   all: `STATEMENT_TIMEOUT_MS` (30s) per statement on the pool, and `GATEWAY_TIMEOUT_MS` (10s)
 *   per Razorpay call. `idempotency-bounds.spec.ts` asserts the ordering.
 *
 * Too short and a slow live attempt is turned away at its commit; too long and a stuck key blocks
 * its user for that long.
 */
export const IDEMPOTENCY_IN_FLIGHT_STALE_MS = 5 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async claim(input: ClaimInput): Promise<ClaimOutcome> {
    const claimedAt = input.claimedAt ?? new Date();

    // Insert, and on a conflict read the holder back. If the holder vanishes between the two (a
    // release or the prune deleting it), the key is free again: claim it once more rather than
    // proceed with no row behind the claim, which would leave `store` matching nothing (S-80).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await this.insertClaim(input, claimedAt)) return { outcome: 'proceed' };

      const [existing] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, input.key));
      if (existing !== undefined) return this.against(existing, input, claimedAt);
    }
    // Vanished twice in a row: something is churning this key. Not safe to run; the client
    // keeps its key and retries.
    return { outcome: 'in_flight' };
  }

  private async insertClaim(input: ClaimInput, claimedAt: Date): Promise<boolean> {
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000);
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
    return inserted.length > 0;
  }

  /** What a retry gets when the key is already held. */
  private async against(
    existing: typeof idempotencyKeys.$inferSelect,
    input: ClaimInput,
    claimedAt: Date,
  ): Promise<ClaimOutcome> {
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

    const sameRequest =
      existing.requestHash === input.requestHash ||
      (input.legacyRequestHash !== undefined && existing.requestHash === input.legacyRequestHash);
    if (!sameRequest) {
      return { outcome: 'conflict' };
    }

    if (existing.responseBody !== null && existing.responseStatus !== null) {
      return {
        outcome: 'replay',
        response: existing.responseBody,
        status: existing.responseStatus,
      };
    }

    if (existing.committedAt !== null) {
      // The write is done. Still running (between commit and store, milliseconds): retry soon and
      // replay. Settled without a response, or stale: it is not coming, and re-running would
      // repeat the write.
      const stale =
        existing.lockedAt === null ||
        existing.lockedAt.getTime() < Date.now() - IDEMPOTENCY_IN_FLIGHT_STALE_MS;
      return stale ? { outcome: 'committed' } : { outcome: 'in_flight' };
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
          // A committed write is never re-run (S-64). Checked here as well as in `against`, so a
          // commit landing between the read and this update still wins.
          isNull(idempotencyKeys.committedAt),
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
   * keep. Without it the key alone decides; every caller in the API passes one
   * (the webhook path since S-75).
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
   * Finishes a claim whose handler failed. Conditioned on `claimedAt` like `store`, and for the
   * same reason: a zombie that deleted a newer retry's claim would let a third attempt claim the
   * key fresh and run alongside it.
   *
   * A claim that never committed a write is deleted, so a retry runs the request again. One that
   * did (`committed_at`, S-64) is kept and settled instead, so the retry is told it already went
   * through rather than repeating the write. `rerunnable` deletes it anyway, for a handler whose
   * committed progress is designed to be resumed by a retry: a domain refusal (4xx) after a saved
   * step, or a webhook whose commands are idempotent by state.
   */
  async release(
    key: string,
    claimedAt?: Date,
    options: { readonly rerunnable?: boolean } = {},
  ): Promise<boolean> {
    const deletable =
      options.rerunnable === true
        ? heldBy(key, claimedAt)
        : and(heldBy(key, claimedAt), isNull(idempotencyKeys.committedAt));
    const released = await this.db
      .delete(idempotencyKeys)
      .where(deletable)
      .returning({ key: idempotencyKeys.key });
    if (released.length > 0) return true;

    const settled = await this.db
      .update(idempotencyKeys)
      .set({ lockedAt: null, updatedAt: new Date() })
      .where(and(heldBy(key, claimedAt), isNotNull(idempotencyKeys.committedAt)))
      .returning({ key: idempotencyKeys.key });
    return settled.length > 0;
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

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request a key stands for: the body AND the concrete target (pentest F2, task 18a review).
 *
 * `endpoint` is the route pattern (`POST /api/v1/admin/users/:id/block`), so the hash was the only
 * thing that could tell `/users/A/block` from `/users/B/block`, and it covered the body alone. One
 * key reused on B replayed A's 200 and B was never acted on. With the path params folded in, that
 * reuse is a conflict (422) instead.
 *
 * Params are Fastify's, already decoded. A uuid-shaped value is lowercased, because Postgres reads
 * `A` and `a` as the same id: the same target in capitals is the same request, and replays. A
 * route with no params hashes exactly as before, so keys stored before this change still match.
 */
export function hashRequest(params: unknown, body: unknown): string {
  return hashCanonicalBody(requestTarget(params, body));
}

function requestTarget(params: unknown, body: unknown): unknown {
  if (typeof params !== 'object' || params === null || Object.keys(params).length === 0) {
    return body;
  }
  const target: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params)) {
    target[name] =
      typeof value === 'string' && UUID_SHAPE.test(value) ? value.toLowerCase() : value;
  }
  return { params: target, body };
}

/**
 * HMAC-SHA256 under a key derived from `ENCRYPTION_KEY`, never a plain hash (S-101). The bodies
 * hashed here include `PUT /me/bank-details` (an account number) and `PUT /me/route-onboarding`
 * (a PAN, a small space): a plain SHA-256 in a leaked `idempotency_keys` table could be brute-forced
 * offline back to those values. HKDF gives this purpose its own key, so the hash key and the field
 * encryption key are never the same bytes.
 */
let requestHashKey: Buffer | undefined;
function hashKey(): Buffer {
  requestHashKey ??= Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.ENCRYPTION_KEY, 'hex'),
      Buffer.alloc(0),
      'parkease:idempotency-request-hash:v1',
      32,
    ),
  );
  return requestHashKey;
}

export function hashCanonicalBody(body: unknown): string {
  return createHmac('sha256', hashKey()).update(canonicalJson(body)).digest('hex');
}

/** The pre-S-101 form, only to match keys stored before the switch (`legacyRequestHash`). */
export function legacyHashCanonicalBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

/** `hashRequest` in the pre-S-101 form; see `legacyRequestHash`. */
export function legacyHashRequest(params: unknown, body: unknown): string {
  return legacyHashCanonicalBody(requestTarget(params, body));
}

function canonicalJson(body: unknown): string {
  return JSON.stringify(sortKeys(body));
}

/**
 * Deeper than any request body this API accepts. Without a cap, a 1 MB body of nested brackets
 * overflowed the stack here and answered 500 (pentest F4, task 18a review).
 */
const MAX_BODY_DEPTH = 64;

function sortKeys(obj: unknown, depth = 0): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (depth >= MAX_BODY_DEPTH) {
    throw new BadRequestException({
      error: 'PAYLOAD_TOO_DEEP',
      message: 'The request body is nested too deeply.',
    });
  }
  if (Array.isArray(obj)) return obj.map((item) => sortKeys(item, depth + 1));
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key], depth + 1);
  }
  return sorted;
}
