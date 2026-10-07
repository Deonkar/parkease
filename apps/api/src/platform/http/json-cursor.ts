import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Keyset cursors as base64url JSON (S-87): one codec for every endpoint that pages on a JSON
 * payload. The payload's shape is each caller's own schema, so a cursor minted by one list never
 * parses as another's.
 */
export function encodeJsonCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** The payload, or undefined for anything malformed or of another shape: never a throw. */
export function decodeJsonCursor<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const payload = schema.safeParse(parsed);
  return payload.success ? payload.data : undefined;
}

/** A cursor the server did not mint, or one from a different list: 400, never 500. */
export class InvalidCursorError extends BadRequestException {
  constructor() {
    super({
      error: 'INVALID_CURSOR',
      message: 'That page link is no longer valid. Pull to refresh.',
    });
  }
}
