import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../config/env.schema.js';

/**
 * Field-level encryption for data we store but must never read back casually —
 * bank account numbers and IFSC codes (security.md §5.1, R-SEC-05).
 *
 * AES-256-GCM with a random 96-bit IV per value, stored as
 * `base64(iv).base64(tag).base64(ciphertext)`. GCM authenticates, so a
 * tampered value throws on decrypt rather than returning plausible garbage.
 * The key is `ENCRYPTION_KEY` (32 bytes as hex), which lives only in the API:
 * the worker pays through an opaque RazorpayX fund account id and never needs it.
 */
const ALGORITHM = 'aes-256-gcm';
/**
 * Pinned on both sides. Without it Node accepts any tag length down to 4 bytes,
 * and a truncated genuine tag verifies — a 32-bit forgery bound instead of 128.
 */
const TAG_BYTES = 16;
const key = () => Buffer.from(env.ENCRYPTION_KEY, 'hex');

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
}

export function decryptField(stored: string): string {
  const [iv, tag, body] = stored.split('.');
  if (iv === undefined || tag === undefined || body === undefined) {
    throw new Error('Encrypted field is not in iv.tag.ciphertext form');
  }
  const authTag = Buffer.from(tag, 'base64');
  if (authTag.length !== TAG_BYTES) throw new Error('Encrypted field has a malformed auth tag');
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, 'base64'), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
