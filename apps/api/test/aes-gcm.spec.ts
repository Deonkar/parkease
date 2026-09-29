import { describe, expect, it } from 'vitest';

import { decryptField, encryptField } from '../src/platform/crypto/aes-gcm.js';

describe('field encryption (AES-256-GCM, ENCRYPTION_KEY)', () => {
  const ACCOUNT = '50100123456789';

  it('round-trips', () => {
    expect(decryptField(encryptField(ACCOUNT))).toBe(ACCOUNT);
  });

  it('never stores the plaintext, even as a substring', () => {
    expect(encryptField(ACCOUNT)).not.toContain(ACCOUNT);
  });

  it('encrypts the same value differently each time (random IV)', () => {
    expect(encryptField(ACCOUNT)).not.toBe(encryptField(ACCOUNT));
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const [iv, tag, body] = encryptField(ACCOUNT).split('.');
    const flipped = `${body?.startsWith('A') === true ? 'B' : 'A'}${body?.slice(1) ?? ''}`;

    expect(() => decryptField(`${iv ?? ''}.${tag ?? ''}.${flipped}`)).toThrow();
  });

  it('refuses a malformed value', () => {
    expect(() => decryptField('not-a-ciphertext')).toThrow();
  });
});
