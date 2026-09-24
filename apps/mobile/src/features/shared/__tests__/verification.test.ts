import { describe, expect, expectTypeOf, it } from 'vitest';

import { canAcceptWork, verificationStateFor, type VerificationState } from '../verification';

describe('verificationStateFor', () => {
  it('maps the four known statuses', () => {
    expect(verificationStateFor('verified')).toBe('verified');
    expect(verificationStateFor('pending')).toBe('pending');
    expect(verificationStateFor('unverified')).toBe('unverified');
    expect(verificationStateFor('rejected')).toBe('rejected');
  });

  it('fails CLOSED on anything it does not recognise', () => {
    // A status added server-side must not be guessed as "probably fine": that
    // is how an unapproved person ends up washing somebody's car.
    expect(verificationStateFor('provisional')).toBe('unknown');
    expect(verificationStateFor('')).toBe('unknown');
  });
});

describe('canAcceptWork', () => {
  it('is true for verified and false for everything else, including unknown', () => {
    expect(canAcceptWork(verificationStateFor('verified'))).toBe(true);
    for (const status of ['pending', 'unverified', 'rejected', 'provisional', '']) {
      expect(canAcceptWork(verificationStateFor(status))).toBe(false);
    }
  });

  /** I2: a parsed state in, never a raw string — the parse is the one place that fails closed. */
  it('takes the parsed state, not a string', () => {
    expectTypeOf(canAcceptWork).parameter(0).toEqualTypeOf<VerificationState>();
    expectTypeOf<VerificationState>().toEqualTypeOf<
      'unverified' | 'pending' | 'verified' | 'rejected' | 'unknown'
    >();
  });
});
