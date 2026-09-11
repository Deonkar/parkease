import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { idempotencyKeys } from '@parkease/db/schema';
import { eq, sql } from 'drizzle-orm';

import { DB, type Database } from '../db/db.module.js';

type ClaimOutcome =
  | { readonly outcome: 'proceed' }
  | { readonly outcome: 'replay'; readonly response: unknown; readonly status: number }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'in_flight' };

interface ClaimInput {
  readonly key: string;
  readonly userId: string;
  readonly endpoint: string;
  readonly requestHash: string;
}

const EXPIRY_HOURS = 24;

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

    return { outcome: 'in_flight' };
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
